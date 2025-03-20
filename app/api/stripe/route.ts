import { auth, currentUser } from "@clerk/nextjs";
import { NextResponse } from "next/server";

import prismadb from "@/lib/prismadb";
import { stripe } from "@/lib/stripe";
import { absoluteUrl } from "@/lib/utils";

const settingsUrl = absoluteUrl("/settings");

export async function GET() {
  try {
    const authResult = await auth();
    const userId = authResult.userId;
    const user = await currentUser();

    if (!userId || !user) {
      console.log("Auth failed:", { userId, user });
      return new NextResponse("Unauthorized", { status: 401 });
    }

    console.log("Creating Stripe session for user:", userId);

    const userSubscription = await prismadb.userSubscription.findUnique({
      where: {
        userId
      }
    });

    if (userSubscription && userSubscription.stripeCustomerId) {
      console.log("User has existing subscription, creating billing portal session");
      try {
        const stripeSession = await stripe.billingPortal.sessions.create({
          customer: userSubscription.stripeCustomerId,
          return_url: settingsUrl
        });

        return new NextResponse(JSON.stringify({ url: stripeSession.url }));
      } catch (stripeError: any) {
        console.error("[STRIPE_PORTAL_ERROR]", stripeError);
        return new NextResponse(
          "Error creating billing portal session", 
          { status: 500 }
        );
      }
    }

    console.log("Creating new checkout session");
    try {
      const stripeSession = await stripe.checkout.sessions.create({
        success_url: settingsUrl,
        cancel_url: settingsUrl,
        payment_method_types: ["card"],
        mode: "subscription",
        billing_address_collection: "auto",
        customer_email: user.emailAddresses[0].emailAddress,
        line_items: [
          {
            price_data: {
              currency: "USD",
              product_data: {
                name: "ContentFuse Pro",
                description: "Unlimited AI Generations."
              },
              unit_amount: 2000,
              recurring: {
                interval: "month"
              }
            },
            quantity: 1
          }
        ],
        metadata: {
          userId
        }
      });

      console.log("Checkout session created successfully:", stripeSession.id);
      return new NextResponse(JSON.stringify({ url: stripeSession.url }));
    } catch (stripeError: any) {
      console.error("[STRIPE_CHECKOUT_ERROR]", stripeError);
      if (stripeError.response) {
        const errorData = stripeError.response.data.error;
        return new NextResponse(
          `Stripe Error: ${errorData.message}`, 
          { status: stripeError.response.status }
        );
      }
      return new NextResponse(
        "Error creating checkout session", 
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error("[STRIPE_ERROR]", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
