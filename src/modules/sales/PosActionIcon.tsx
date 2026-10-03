export type PosActionIconName = 'cash' | 'bankTransfer' | 'draft' | 'voice' | 'qrScanner' | 'search';

function PosActionArtwork({ name }: { name: PosActionIconName }) {
  switch (name) {
    case 'cash':
      return (
        <>
          <rect x="3.5" y="6" width="17" height="12" rx="2.4" />
          <circle cx="12" cy="12" r="2.6" />
          <path d="M7.2 9.2c.85 0 1.55-.7 1.55-1.55M16.8 9.2c-.85 0-1.55-.7-1.55-1.55M7.2 14.8c.85 0 1.55.7 1.55 1.55M16.8 14.8c-.85 0-1.55.7-1.55 1.55" />
        </>
      );
    case 'bankTransfer':
      return (
        <>
          <path d="M4 9.2 12 4l8 5.2" />
          <path d="M5.5 10h13M6.5 10v7M10.2 10v7M13.8 10v7M17.5 10v7M4.5 18.5h15" />
          <path d="M8 21h8" />
          <path d="m15.7 5.2 2.4 1.5-2.4 1.5" />
        </>
      );
    case 'draft':
      return (
        <>
          <path d="M6 3.8h8.2L19 8.6V20a1.7 1.7 0 0 1-1.7 1.7H6A1.7 1.7 0 0 1 4.3 20V5.5A1.7 1.7 0 0 1 6 3.8Z" />
          <path d="M14 3.8v5h5" />
          <path d="M8 13h8M8 16.5h5.5" />
          <path d="M8 9.5h3" />
        </>
      );
    case 'voice':
      return (
        <>
          <rect x="8.2" y="3.5" width="7.6" height="11" rx="3.8" />
          <path d="M5.8 11.6a6.2 6.2 0 0 0 12.4 0M12 17.8v3M8.8 20.8h6.4" />
        </>
      );
    case 'qrScanner':
      return (
        <>
          <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
          <rect x="7.2" y="7.2" width="3.2" height="3.2" rx=".55" />
          <rect x="13.6" y="7.2" width="3.2" height="3.2" rx=".55" />
          <rect x="7.2" y="13.6" width="3.2" height="3.2" rx=".55" />
          <path d="M13.6 13.6h1.3v1.3h1.9M13.6 16.8h1.3M16.8 15.5v1.3" />
        </>
      );
    case 'search':
      return (
        <>
          <circle cx="10.5" cy="10.5" r="5.7" />
          <path d="m14.8 14.8 5 5" />
        </>
      );
    default:
      return null;
  }
}

export default function PosActionIcon({ name }: { name: PosActionIconName }) {
  return (
    <span className={`sales-action-icon sales-action-icon--${name}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <PosActionArtwork name={name} />
      </svg>
    </span>
  );
}
