import { RiskAuraOverlay } from "./RiskAuraOverlay";
import { SecurityOverlayCard } from "./SecurityOverlayCard";

export function GlobalOverlayHost() {
  return (
    <>
      <RiskAuraOverlay />
      <SecurityOverlayCard />
    </>
  );
}
