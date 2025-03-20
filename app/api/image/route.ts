import { auth } from "@clerk/nextjs";
import { NextResponse } from "next/server";

import { checkApiLimit, increaseApiLimit } from "@/lib/api-limit";
import { checkSubscription } from "@/lib/subscription";

export async function POST(req: Request) {
  try {
    const authResult = await auth();
    
    if (!authResult || !authResult.userId) {
      console.log("Auth failed:", authResult);
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const userId = authResult.userId;
    console.log("Auth successful for user:", userId);

    const body = await req.json();
    const { prompt, amount = 1, resolution = "512x512" } = body;

    if (!process.env.EDEN_AI_API_KEY) {
      return new NextResponse("Eden AI API Key Not Configured", { status: 500 });
    }

    if (!prompt) {
      return new NextResponse("Prompt is Required", { status: 400 });
    }

    if (!amount) return new NextResponse("Amount is Required", { status: 400 });

    if (!resolution)
      return new NextResponse("Resolution is Required", { status: 400 });

    const freeTrial = await checkApiLimit();
    const isPro = await checkSubscription();

    if (!freeTrial && !isPro) {
      return new NextResponse("Free Trial Has Expired", { status: 403 });
    }

    try {
      // Try multiple providers in case one is unavailable
      const providers = ["openai", "stabilityai", "replicate"];
      let lastError = null;

      for (const provider of providers) {
        try {
          const response = await fetch("https://api.edenai.run/v2/image/generation", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${process.env.EDEN_AI_API_KEY}`
            },
            body: JSON.stringify({
              providers: provider,
              text: prompt,
              n: parseInt(amount, 10),
              resolution: resolution.replace("x", "×"),
              response_format: "url"
            })
          });

          const data = await response.json();
          console.log(`[EDEN_RESPONSE_${provider.toUpperCase()}]`, JSON.stringify(data, null, 2));

          // Check for provider errors
          if (data[provider]?.status === 'fail') {
            const errorMessage = data[provider].error?.message || "Failed to generate image";
            console.error(`[EDEN_PROVIDER_ERROR_${provider.toUpperCase()}]`, data[provider].error);
            
            // Handle specific errors
            if (errorMessage.includes('invalid_size')) {
              return new NextResponse("The selected image size is not supported. Please try a different size.", { status: 400 });
            }
            
            if (errorMessage.includes('unavailable')) {
              lastError = errorMessage;
              continue; // Try next provider
            }
            
            return new NextResponse(errorMessage, { status: 400 });
          }

          // Check for image URL in the response
          const items = data[provider]?.items?.[0];
          console.log(`[EDEN_ITEMS_${provider.toUpperCase()}]`, JSON.stringify(items, null, 2));
          
          const imageUrl = items?.image_resource_url || 
                          items?.url ||
                          items?.image_url ||
                          items?.image;

          if (!imageUrl) {
            console.error(`[EDEN_RESPONSE_NO_URL_${provider.toUpperCase()}]`, JSON.stringify(data, null, 2));
            lastError = "No image URL in response";
            continue; // Try next provider
          }

          if (!isPro) {
            await increaseApiLimit();
          }

          console.log(`[RETURNING_IMAGE_URL]`, imageUrl);
          return new NextResponse(JSON.stringify({
            url: imageUrl
          }), {
            headers: {
              'Content-Type': 'application/json',
            },
          });
        } catch (providerError: any) {
          console.error(`[EDEN_ERROR_${provider.toUpperCase()}]`, providerError);
          lastError = providerError.message;
          continue; // Try next provider
        }
      }

      // If we get here, all providers failed
      return new NextResponse(
        `All image generation providers are currently unavailable. Please try again later. Last error: ${lastError}`, 
        { status: 503 }
      );

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
      
      return new NextResponse(edenError.message || "Error generating image", { status: 500 });
    }
  } catch (error: any) {
    console.error("[IMAGE_ERROR]", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
