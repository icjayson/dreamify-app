import { TrendingUp, AlertTriangle, Box } from "lucide-react";

export const FinanceFeaturesSection = () => {
  const features = [
    {
      title: "Cashflow Scenario Exploration",
      description: "Use an uploaded dataset to explore bounded scenarios such as a sales decline or a planned hiring change. Verify every generated assumption.",
      icon: TrendingUp
    },
    {
      title: "Budget Variance Analysis",
      description: "Compare budget and actual columns in an uploaded file, then inspect the rows behind a variance. Real-time alerts are not enabled.",
      icon: AlertTriangle
    },
    {
      title: "Unit Economics Templates",
      description: "Create CAC, LTV, churn, and cohort views when the required fields exist in your uploaded data.",
      icon: Box
    }
  ];

  return (
    <section className="py-24 relative overflow-hidden">
      <div className="relative z-10 container mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-instrument-serif text-white">
            The FP&A Feature Grid
          </h2>
          <p className="text-md text-white/60 mt-4">
            File-based analysis patterns for evaluation in the non-commercial preview.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
          {features.map((feature, idx) => (
            <div
              key={idx}
              className="group p-8 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md transition-all duration-300 hover:bg-white/10"
            >
              <div className="w-12 h-12 flex items-center justify-center rounded-lg bg-white/10 mb-6 group-hover:bg-white/20 transition-colors">
                <feature.icon className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-3">
                {feature.title}
              </h3>
              <p className="text-white/70 leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
