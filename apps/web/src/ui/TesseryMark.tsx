/** Tessery's mark: four mosaic tiles in the brand indigo and the three environment colours. */
export function TesseryMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1" y="1" width="6.5" height="6.5" rx="1.6" fill="var(--acc)" />
      <rect x="8.5" y="1" width="6.5" height="6.5" rx="1.6" fill="var(--env-dev)" />
      <rect x="1" y="8.5" width="6.5" height="6.5" rx="1.6" fill="var(--env-staging)" />
      <rect x="8.5" y="8.5" width="6.5" height="6.5" rx="1.6" fill="var(--env-prod)" />
    </svg>
  )
}
