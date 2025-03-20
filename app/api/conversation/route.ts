import { auth } from "@clerk/nextjs";
import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

import { checkApiLimit, increaseApiLimit } from "@/lib/api-limit";
import { checkSubscription } from "@/lib/subscription";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

export async function POST(req: Request) {
  try {
    const authResult = await auth();
    const userId = authResult.userId;

    if (!userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const body = await req.json();
    const { messages } = body;

    if (!process.env.GOOGLE_API_KEY) {
      return new NextResponse("Google API Key Not Configured", { status: 500 });
    }

    if (!messages || !Array.isArray(messages)) {
      return new NextResponse("Messages must be an array", { status: 400 });
    }

    const freeTrial = await checkApiLimit();
    const isPro = await checkSubscription();

    if (!freeTrial && !isPro) {
      return new NextResponse("Free Trial Has Expired", { status: 403 });
    }

    try {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
      
      // Convert messages to Gemini format
      const geminiMessages = messages.map(msg => ({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.content }]
      }));

      const chat = model.startChat({
        history: geminiMessages.slice(0, -1),
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1000,
        },
      });

      const result = await chat.sendMessage(messages[messages.length - 1].content);
      const response = await result.response;

      if (!isPro) {
        await increaseApiLimit();
      }

      return NextResponse.json({
        role: "assistant",
        content: response.text()
      });
    } catch (geminiError: any) {
      console.error("[GEMINI_ERROR]", geminiError);
      
      if (geminiError.response?.data?.error) {
        const errorData = geminiError.response.data.error;
        
        switch (errorData.code) {
          case 'RESOURCE_EXHAUSTED':
            return new NextResponse("API quota exceeded. Please try again later.", { status: 503 });
          case 'RATE_LIMIT_EXCEEDED':
            return new NextResponse("Rate limit exceeded. Please try again in a few minutes.", { status: 429 });
          case 'INVALID_API_KEY':
            return new NextResponse("Invalid Google API key configuration.", { status: 500 });
          case 'CONTEXT_LENGTH_EXCEEDED':
            return new NextResponse("Message too long. Please try with a shorter prompt.", { status: 400 });
          default:
            return new NextResponse(`Gemini Error: ${errorData.message}`, { status: 500 });
        }
      }
      
      return new NextResponse("Error communicating with Gemini", { status: 500 });
    }
  } catch (error: any) {
    console.error("[CONVERSATION_ERROR]", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
