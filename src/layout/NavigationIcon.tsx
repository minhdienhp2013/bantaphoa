export type NavigationIconName =
  | 'dashboard'
  | 'sales'
  | 'products'
  | 'reports'
  | 'customers'
  | 'suppliers'
  | 'purchases'
  | 'debts'
  | 'inventory'
  | 'stockouts'
  | 'stocktakes'
  | 'expenses'
  | 'qrPrinting'
  | 'users'
  | 'settings';

function IconArtwork({ name }: { name: NavigationIconName }) {
  switch (name) {
    case 'dashboard':
      return (
        <>
          <rect x="3.5" y="4" width="6.5" height="6.5" rx="1.6" />
          <rect x="14" y="4" width="6.5" height="4.2" rx="1.4" />
          <rect x="14" y="12" width="6.5" height="8" rx="1.6" />
          <rect x="3.5" y="14" width="6.5" height="6" rx="1.6" />
        </>
      );
    case 'sales':
      return (
        <>
          <path d="M4 5h2l1.15 8.05a2 2 0 0 0 1.98 1.72h7.8a2 2 0 0 0 1.96-1.62L20 8H7" />
          <circle cx="9.2" cy="18.5" r="1.2" />
          <circle cx="17.2" cy="18.5" r="1.2" />
          <path d="M11 5.5h5.5M13.75 3v5" />
        </>
      );
    case 'products':
      return (
        <>
          <path d="m4.5 7 7.5-4 7.5 4-7.5 4-7.5-4Z" />
          <path d="M4.5 7v9l7.5 4 7.5-4V7M12 11v9" />
          <path d="m8.3 5 7.5 4" />
        </>
      );
    case 'reports':
      return (
        <>
          <rect x="4" y="3.5" width="16" height="17" rx="2.2" />
          <path d="M8 15v-3M12 15V9M16 15v-6" />
          <path d="M7.5 18h9" />
          <path d="M8 6.7h4.5" />
        </>
      );
    case 'customers':
      return (
        <>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.8 19c.45-4 2.25-6 5.2-6s4.75 2 5.2 6" />
          <circle cx="17" cy="9" r="2.2" />
          <path d="M15.4 14.1c3.1-.2 4.8 1.45 5 4.5" />
        </>
      );
    case 'suppliers':
      return (
        <>
          <path d="M3.5 6.5h10v10h-10z" />
          <path d="M13.5 10h3.1l3.1 3.2v3.3h-6.2z" />
          <circle cx="7" cy="18" r="1.5" />
          <circle cx="17" cy="18" r="1.5" />
          <path d="M5.5 4h6" />
        </>
      );
    case 'purchases':
      return (
        <>
          <path d="M4 9.5 12 5l8 4.5V18l-8 3-8-3V9.5Z" />
          <path d="M4 9.5 12 13l8-3.5M12 13v8" />
          <path d="M12 2v5M9.7 4.7 12 7l2.3-2.3" />
        </>
      );
    case 'debts':
      return (
        <>
          <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
          <path d="M3.5 9h17" />
          <circle cx="16.5" cy="14" r="1.5" />
          <path d="M7 14h4" />
        </>
      );
    case 'inventory':
      return (
        <>
          <path d="M3.5 9 12 4l8.5 5v11h-17V9Z" />
          <path d="M7 20v-7h10v7M7 13h10M9 16h2M13 16h2" />
        </>
      );
    case 'stockouts':
      return (
        <>
          <path d="m4.5 8 7.5-4 7.5 4-7.5 4-7.5-4Z" />
          <path d="M4.5 8v9l7.5 3.5 7.5-3.5V8M12 12v8.5" />
          <path d="M16 3h5M18.5.5V5.5" />
        </>
      );
    case 'stocktakes':
      return (
        <>
          <rect x="5" y="4.5" width="14" height="16" rx="2" />
          <path d="M9 4.5V3h6v1.5" />
          <path d="m8.5 11 2 2 4.5-4.5" />
          <path d="M8 16h8" />
        </>
      );
    case 'expenses':
      return (
        <>
          <path d="M6 3.5h12v17l-3-1.8-3 1.8-3-1.8-3 1.8v-17Z" />
          <path d="M9 8h6M9 11.5h6M9 15h3.5" />
          <path d="M16.8 14.2v4.2M14.7 16.3h4.2" />
        </>
      );
    case 'qrPrinting':
      return (
        <>
          <path d="M4 4h5v5H4zM15 4h5v5h-5zM4 15h5v5H4z" />
          <path d="M15 14h2v2h-2zM18 14h2v5h-2M14 18h3v2h-3" />
          <path d="M11 5v4M11 12h3M7 11v2" />
        </>
      );
    case 'users':
      return (
        <>
          <circle cx="10" cy="8" r="3" />
          <path d="M4.5 19c.4-4 2.25-6 5.5-6 2.1 0 3.65.85 4.6 2.55" />
          <path d="m17.2 13.2.55 1.25 1.35.15-.95 1 .25 1.35-1.2-.65-1.2.65.25-1.35-.95-1 1.35-.15.55-1.25Z" />
        </>
      );
    case 'settings':
      return (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2.8v2M12 19.2v2M21.2 12h-2M4.8 12h-2M18.5 5.5 17.1 6.9M6.9 17.1l-1.4 1.4M18.5 18.5l-1.4-1.4M6.9 6.9 5.5 5.5" />
          <circle cx="12" cy="12" r="7.2" />
        </>
      );
    default:
      return null;
  }
}

export default function NavigationIcon({ name }: { name: NavigationIconName }) {
  return (
    <span className="nav-link__icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <IconArtwork name={name} />
      </svg>
    </span>
  );
}
