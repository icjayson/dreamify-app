import React from 'react';
import DashboardPreview from './DashboardPreview';

interface DashboardWithPDFProps {
  dataSource?: string;
  dashboardId?: string;
  className?: string;
  style?: React.CSSProperties;
  processedData?: any;
}

const DashboardWithPDF: React.FC<DashboardWithPDFProps> = (props) => {
  const targetRef = React.useRef<HTMLDivElement | null>(null);

  return (
    <div ref={targetRef}>
      <DashboardPreview {...props} />
    </div>
  );
};

export default DashboardWithPDF;
