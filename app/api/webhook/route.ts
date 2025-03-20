import Stripe from "stripe";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

import prismadb from "@/lib/prismadb";
import { stripe } from "@/lib/stripe";

export async function POST(req: Request) {
  const body = await req.text();
  const headersList = await headers();
  const signature = headersList.get("Stripe-Signature") as string;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (error: any) {
    console.error("Error verifying webhook signature:", error);
    return new NextResponse(`Webhook Error: ${error.message}`, { status: 400 });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  console.log("Webhook event type:", event.type);
  console.log("Session metadata:", session?.metadata);

  if (event.type === "checkout.session.completed") {
    try {
      const subscription = await stripe.subscriptions.retrieve(
        session.subscription as string
      );

      if (!session?.metadata?.userId) {
        console.error("No userId found in session metadata");
        return new NextResponse("User ID is Required", { status: 400 });
      }

      console.log("Creating subscription for user:", session.metadata.userId);
      
      await prismadb.userSubscription.create({
        data: {
          userId: session?.metadata?.userId,
          stripeSubscriptionId: subscription.id,
          stripeCustomerId: subscription.customer as string,
          stripePriceId: subscription.items.data[0].price.id,
          stripeCurrentPeriodEnd: new Date(subscription.current_period_end * 1000)
        }
      });

      console.log("Subscription created successfully");
    } catch (error) {
      console.error("Error processing checkout.session.completed:", error);
      return new NextResponse("Error processing subscription", { status: 500 });
    }
  }

  if (event.type === "invoice.payment_succeeded") {
    try {
      const subscription = await stripe.subscriptions.retrieve(
        session.subscription as string
      );

      console.log("Updating subscription:", subscription.id);

      await prismadb.userSubscription.update({
        where: {
          stripeSubscriptionId: subscription.id
        },
        data: {
          stripePriceId: subscription.items.data[0].price.id,
          stripeCurrentPeriodEnd: new Date(subscription.current_period_end * 1000)
        }
      });

      console.log("Subscription updated successfully");
    } catch (error) {
      console.error("Error processing invoice.payment_succeeded:", error);
      return new NextResponse("Error updating subscription", { status: 500 });
    }
  }

  return new NextResponse(null, { status: 200 });
}
