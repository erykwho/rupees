import { useId } from "react";
import { cn } from "@/lib/utils";

interface RupeesLogoProps {
  className?: string;
}

export function RupeesLogo({ className }: RupeesLogoProps) {
  const uid = useId().replace(/:/g, "");

  const clipId = `rupees-clip-${uid}`;
  const bevelTr = `rupees-btr-${uid}`;
  const bevelR = `rupees-br-${uid}`;
  const bevelBr = `rupees-bbr-${uid}`;
  const bevelBl = `rupees-bbl-${uid}`;
  const bevelL = `rupees-bl-${uid}`;
  const bevelTl = `rupees-btl-${uid}`;
  const tableFill = `rupees-tbl-${uid}`;
  const sheenMain = `rupees-sm-${uid}`;
  const sheenSoft = `rupees-ss-${uid}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      fill="none"
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      <defs>
        <clipPath id={clipId}>
          <path d="M 240 46 Q 256 36 272 46 L 394 120 Q 410 130 410 148 L 410 364 Q 410 382 394 392 L 272 466 Q 256 476 240 466 L 118 392 Q 102 382 102 364 L 102 148 Q 102 130 118 120 Z" />
        </clipPath>
        <linearGradient id={bevelTr} x1="256" y1="36" x2="410" y2="166" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#86EFAC" />
          <stop offset="55%" stopColor="#A7F3D0" />
          <stop offset="100%" stopColor="#D1FAE5" />
        </linearGradient>
        <linearGradient id={bevelR} x1="410" y1="130" x2="350" y2="382" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#6EE7B7" />
          <stop offset="50%" stopColor="#2DD4BF" />
          <stop offset="100%" stopColor="#0D9488" />
        </linearGradient>
        <linearGradient id={bevelBr} x1="410" y1="382" x2="256" y2="476" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#059669" />
          <stop offset="100%" stopColor="#047857" />
        </linearGradient>
        <linearGradient id={bevelBl} x1="102" y1="382" x2="256" y2="476" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#022C22" />
          <stop offset="100%" stopColor="#064E3B" />
        </linearGradient>
        <linearGradient id={bevelL} x1="102" y1="130" x2="162" y2="382" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#059669" />
          <stop offset="55%" stopColor="#047857" />
          <stop offset="100%" stopColor="#064E3B" />
        </linearGradient>
        <linearGradient id={bevelTl} x1="102" y1="130" x2="256" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#059669" />
          <stop offset="50%" stopColor="#10B981" />
          <stop offset="100%" stopColor="#34D399" />
        </linearGradient>
        <linearGradient id={tableFill} x1="162" y1="108" x2="350" y2="404" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0D9488" />
          <stop offset="52%" stopColor="#10B981" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
        <linearGradient id={sheenMain} x1="170" y1="430" x2="395" y2="110" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#34D399" stopOpacity="0.22" />
          <stop offset="55%" stopColor="#A7F3D0" stopOpacity="0.38" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.62" />
        </linearGradient>
        <linearGradient id={sheenSoft} x1="110" y1="360" x2="320" y2="70" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#10B981" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#A7F3D0" stopOpacity="0.26" />
        </linearGradient>
      </defs>

      <g clipPath={`url(#${clipId})`}>
        <polygon points="256,36 410,130 350,166 256,108" fill={`url(#${bevelTr})`} />
        <polygon points="410,130 410,382 350,346 350,166" fill={`url(#${bevelR})`} />
        <polygon points="410,382 256,476 256,404 350,346" fill={`url(#${bevelBr})`} />
        <polygon points="256,476 102,382 162,346 256,404" fill={`url(#${bevelBl})`} />
        <polygon points="102,382 102,130 162,166 162,346" fill={`url(#${bevelL})`} />
        <polygon points="102,130 256,36 256,108 162,166" fill={`url(#${bevelTl})`} />
        <polygon
          points="256,108 350,166 350,346 256,404 162,346 162,166"
          fill={`url(#${tableFill})`}
        />
        <polygon points="102,354 274,80 342,102 152,406" fill={`url(#${sheenSoft})`} />
        <polygon points="196,436 372,110 426,142 250,468" fill={`url(#${sheenMain})`} />
        <path d="M 192 436 L 370 112" stroke="#D1FAE5" strokeOpacity="0.55" strokeWidth="3.5" />
        <path d="M 152 308 L 260 114" stroke="#A7F3D0" strokeOpacity="0.38" strokeWidth="2.5" />
      </g>
    </svg>
  );
}
