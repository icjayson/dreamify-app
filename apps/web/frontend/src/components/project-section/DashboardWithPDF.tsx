import React from 'react';
import DashboardPreview from './DashboardPreview';
import { useDashboardPDF } from '@/utils/exportUtils';

interface DashboardWithPDFProps {
  dataSource?: string;
  dashboardId?: string;
  className?: string;
  style?: React.CSSProperties;
  processedData?: any;
}

const DashboardWithPDF: React.FC<DashboardWithPDFProps> = (props) => {
  const { targetRef } = useDashboardPDF();

  return (
    <div ref={targetRef}>
      <DashboardPreview {...props} />
    </div>
  );
};

export default DashboardWithPDF;
