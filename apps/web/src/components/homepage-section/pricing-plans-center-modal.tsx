import React from "react";

import { PricingPlansSection } from "@/components/homepage-section/pricing-plans";

export const PricingPlansCenterModal: React.FC<{ className?: string }> = ({ className }) => (
  <PricingPlansSection className={className} />
);
