/** Identidade Mind2Matter: monograma M2 (vetor) e assinatura da marca. */
export const BRAND = {
  name: "MIND2MATTER",
  tagline: "3D PRINTING",
  product: "Mercado Livre Intelligence",
};

export function M2Mark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="Mind2Matter">
      <path d="M4 15 L17 4 L32 18 L47 4 L60 15 L60 50 L56 54 L56 59 L8 59 L8 54 L4 50 Z" fill="#0B0B0D" stroke="#F26A1B" strokeWidth="3" strokeLinejoin="miter" />
      <path d="M10 18 L17 11 L32 26 L32 30 L24 22 L24 53 L10 53 Z" fill="#EDE6D6" />
      <path d="M54 18 L47 11 L35 23 L40 27 L42 25 L42 53 L54 53 Z" fill="#EDE6D6" />
      <path d="M25 31 L37 31 L40 34 L40 43 L31 43 L31 46 L40 46 L40 53 L25 53 L25 41 L34 41 L34 37 L25 37 Z" fill="#EDE6D6" stroke="#0B0B0D" strokeWidth="1.6" strokeLinejoin="miter" />
    </svg>
  );
}

export function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <M2Mark className={compact ? "size-8" : "size-10"} />
      <div className="leading-none">
        <div className="font-brand text-[15px] text-ink">
          MIND<span className="text-brand">2</span>MATTER
        </div>
        <div className="mt-1 text-[9px] font-semibold tracking-[0.22em] text-brand">ML INTELLIGENCE</div>
      </div>
    </div>
  );
}
