import type { QuickServiceId } from './salesPosUi';

interface QuickServiceIconProps {
  serviceId: QuickServiceId;
}

const commonProps = {
  viewBox: '0 0 96 96',
  fill: 'none',
  xmlns: 'http://www.w3.org/2000/svg',
} as const;

function PhotocopyIcon() {
  return (
    <svg {...commonProps}>
      <path d="M28 19h40l8 10v42H20V29l8-10Z" className="qsi-panel" />
      <path d="M27 31h42M27 44h42" className="qsi-line" />
      <path d="M31 12h35l10 8-31 9H27l4-17Z" className="qsi-paper" />
      <path d="M31 52h34l-4 18H35l-4-18Z" className="qsi-paper" />
      <path d="M39 58h18M41 63h14" className="qsi-accent-line" />
      <circle cx="61" cy="37" r="2.8" className="qsi-accent-fill" />
      <circle cx="68" cy="37" r="2.8" className="qsi-accent-fill" />
      <path d="M26 71v5M70 71v5" className="qsi-line" />
    </svg>
  );
}

function PrintLaminateIcon() {
  return (
    <svg {...commonProps}>
      <path d="M31 15h34v22H31V15Z" className="qsi-paper" />
      <path d="M22 34h52a8 8 0 0 1 8 8v24H14V42a8 8 0 0 1 8-8Z" className="qsi-panel" />
      <path d="M29 55h38l-4 22H33l-4-22Z" className="qsi-paper" />
      <path d="M39 62h18M38 68h20" className="qsi-accent-line" />
      <circle cx="68" cy="46" r="3" className="qsi-accent-fill" />
      <circle cx="75" cy="46" r="3" className="qsi-accent-fill" />
      <path d="M18 46h11" className="qsi-accent-line" />
    </svg>
  );
}

function ScanIcon() {
  return (
    <svg {...commonProps}>
      <path d="M24 31 38 18h35l9 14-11 41H19l5-42Z" className="qsi-panel" />
      <path d="M38 18 25 31l16 7h30l11-6-9-14H38Z" className="qsi-paper" />
      <path d="M31 40h39l-5 24H27l4-24Z" className="qsi-paper" />
      <path d="M37 48h22M35 54h25M34 60h18" className="qsi-accent-line" />
      <path d="M18 70h53" className="qsi-line" />
    </svg>
  );
}

function ComputerIcon() {
  return (
    <svg {...commonProps}>
      <rect x="20" y="14" width="56" height="43" rx="4" className="qsi-panel" />
      <rect x="27" y="21" width="42" height="28" rx="2" className="qsi-paper" />
      <path d="M37 29h22M37 35h18M37 41h20" className="qsi-accent-line" />
      <path d="M48 57v8M37 65h22" className="qsi-line" />
      <path d="M24 70h45l7 10H18l6-10Z" className="qsi-paper" />
      <path d="M27 75h35M31 79h29" className="qsi-accent-line" />
      <path d="M77 66c5 0 8 4 8 8s-3 7-8 7-8-3-8-7 3-8 8-8Z" className="qsi-paper" />
    </svg>
  );
}

function StationeryIcon() {
  return (
    <svg {...commonProps}>
      <path d="M46 32h31v43H46V32Z" className="qsi-paper" />
      <path d="M46 40h31M53 48h17M53 55h15M53 62h16" className="qsi-accent-line" />
      <path d="M18 42h26l-3 34H21l-3-34Z" className="qsi-panel" />
      <path d="m24 42 3-27 7-2 2 29" className="qsi-paper" />
      <path d="m34 42 9-27 7 3-7 25" className="qsi-paper" />
      <path d="M29 23h7M40 25l8 3" className="qsi-accent-line" />
      <path d="M75 38h6v31h-6" className="qsi-line" />
    </svg>
  );
}

function OtherIcon() {
  return (
    <svg {...commonProps}>
      <path d="m21 32 27-15 27 15-27 15-27-15Z" className="qsi-paper" />
      <path d="M21 32v34l27 13 27-13V32L48 47 21 32Z" className="qsi-panel" />
      <path d="M48 47v32" className="qsi-line" />
      <path d="m36 23 28 15" className="qsi-accent-line" />
      <circle cx="72" cy="65" r="15" className="qsi-plus-disc" />
      <path d="M72 57v16M64 65h16" className="qsi-plus-mark" />
    </svg>
  );
}

export default function QuickServiceIcon({ serviceId }: QuickServiceIconProps) {
  switch (serviceId) {
    case 'photo':
      return <PhotocopyIcon />;
    case 'printing':
      return <PrintLaminateIcon />;
    case 'scan':
      return <ScanIcon />;
    case 'computer':
      return <ComputerIcon />;
    case 'stationery':
      return <StationeryIcon />;
    case 'other':
      return <OtherIcon />;
    default:
      return null;
  }
}
