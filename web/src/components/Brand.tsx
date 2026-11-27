/** Identidade Mind2Matter: logo oficial e assinatura da marca. */
export const BRAND = {
  name: "MIND2MATTER",
  tagline: "3D PRINTING",
  product: "Intelligence",
};

/** Logo oficial Mind2Matter (PNG com transparência). */
export function M2Mark({ className = "size-8", large = false }: { className?: string; large?: boolean }) {
  return <img src={large ? "/brand/mind2matter-logo.png" : "/brand/mind2matter-logo-128.png"} alt="Mind2Matter 3D Printing" className={`${className} object-contain`} draggable={false} />;
}

export function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <M2Mark className={compact ? "size-9" : "size-11"} />
      <div className="leading-none">
        <div className="font-brand text-[15px] font-bold tracking-wide text-ink">
          MIND<span className="text-brand">2</span>MATTER
        </div>
        <div className="mt-1 text-[9px] font-semibold tracking-[0.28em] text-brand">INTELLIGENCE</div>
      </div>
    </div>
  );
}
