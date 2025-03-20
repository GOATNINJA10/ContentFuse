import { auth } from "@clerk/nextjs";
import { NextResponse } from "next/server";

import { checkApiLimit, increaseApiLimit } from "@/lib/api-limit";
import { checkSubscription } from "@/lib/subscription";

export async function POST(req: Request) {
  try {
    const authResult = await auth();
    const userId = authResult.userId;

    if (!userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const body = await req.json();
    const { prompt } = body;

    if (!prompt) {
      return new NextResponse("Prompt is Required", { status: 400 });
    }

    const freeTrial = await checkApiLimit();
    const isPro = await checkSubscription();

    if (!freeTrial && !isPro) {
      return new NextResponse("Free Trial Has Expired", { status: 403 });
    }

    try {
      const headers = new Headers();
      headers.append("Content-Type", "application/json");
      headers.append("Authorization", `Bearer ${process.env.EDEN_AI_API_KEY}`);

      const response = await fetch("https://api.edenai.run/v2/video/generation", {
        method: "POST",
        headers,
        body: JSON.stringify({
          providers: "runway",
          text: prompt,
          resolution: "1024x576",
          fps: 24,
          duration: 3
        })
      });

      const data = await response.json();

      if (!response.ok) {
        console.error("[EDEN_ERROR_RESPONSE]", data);
        throw new Error(data.error?.message || "Failed to generate video");
      }

      if (!data.runway?.items?.[0]?.video_resource_url) {
        throw new Error("No video URL in response");
      }

      if (!isPro) {
        await increaseApiLimit();
      }

      return NextResponse.json({
        url: data.runway.items[0].video_resource_url
      });
    } catch (edenError: any) {
      console.error("[EDEN_ERROR]", edenError);
      
      if (edenError.response) {
        const errorData = edenError.response.data;
        
        switch (errorData.code) {
          case 'INSUFFICIENT_CREDITS':
            return new NextResponse("Insufficient credits. Please upgrade your plan.", { status: 402 });
          case 'RATE_LIMIT_EXCEEDED':
            return new NextResponse("Rate limit exceeded. Please try again in a few minutes.", { status: 429 });
          case 'INVALID_API_KEY':
            return new NextResponse("Invalid Eden AI API key configuration.", { status: 500 });
          default:
            return new NextResponse(`Eden AI Error: ${errorData.message}`, { status: 500 });
        }
      }
      
      return new NextResponse(edenError.message || "Error generating video", { status: 500 });
    }
  } catch (error: any) {
    console.error("[VIDEO_ERROR]", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
