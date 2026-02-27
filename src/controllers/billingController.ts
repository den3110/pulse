import { Request, Response } from "express";

export const getPlans = async (req: Request, res: Response) => {
  try {
    // Usually this might fetch from a database or Stripe directly,
    // but hardcoding the configuration payload here allows the frontend to dynamically render tiers.
    const plans = [
      {
        id: "free",
        name: "Free",
        price: 0,
        interval: "month",
        features: [
          "1 Server Limit",
          "Up to 3 Projects",
          "Community Support",
          "Standard Deployments",
        ],
        highlighted: false,
        buttonText: "Current Plan",
      },
      {
        id: "pro",
        name: "Pro",
        price: 19,
        interval: "month",
        features: [
          "5 Server Limit",
          "Unlimited Projects",
          "Priority Support",
          "Fast Deployments",
          "Advanced Analytics",
        ],
        highlighted: true,
        buttonText: "Upgrade to Pro",
      },
      {
        id: "enterprise",
        name: "Enterprise",
        price: 99,
        interval: "month",
        features: [
          "Unlimited Servers",
          "Unlimited Projects",
          "24/7 Dedicated Support",
          "Custom SLAs",
          "Advanced Security Features",
          "White-labeling",
        ],
        highlighted: false,
        buttonText: "Contact Sales",
      },
    ];

    res.json(plans);
  } catch (error: any) {
    res.status(500).json({ message: "Error fetching pricing plans" });
  }
};
