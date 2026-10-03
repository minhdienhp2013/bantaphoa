import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { Dialog } from '../../shared/ui/dialog';
import type { QuickServiceCategory } from '../../types/models';
import BackupPanel from '../backup/BackupPanel';
import BusinessDataResetPanel from '../backup/BusinessDataResetPanel';
import TransactionHistoryResetPanel from '../backup/TransactionHistoryResetPanel';
import ReceiptSettingsPanel from './ReceiptSettingsPanel';
import DeviceSettingsPage from './DeviceSettingsPage';
import A4InvoiceSettingsPanel from './A4InvoiceSettingsPanel';
import SalesAiLearningPanel from './SalesAiLearningPanel';
import '../reports/reports.css';
import {
  DEFAULT_QUICK_SERVICE_PROFIT_RATES_PERCENT,
  QUICK_SERVICE_CATEGORIES,
  QUICK_SERVICE_CATEGORY_LABELS,
  saveQuickServiceProfitRates,
  subscribeQuickServiceProfitRates,
} from './quickServiceSettings';
import './settings.css';
import './settingsDesktopMobilePolish.css';

type RateDraft = Record<QuickServiceCategory, string>;
type RetryFocusTarget = 'retry' | null;
type SettingsPanel = 'rates' | 'receipt' | 'a4-invoice' | 'sales-ai' | 'backup' | 'history-reset' | 'business-reset' | null;

function toDraft(rates: Record<QuickServiceCategory, number>): RateDraft {
  return Object.fromEntries(
    QUICK_SERVICE_CATEGORIES.map((category) => [category, String(rates[category])]),
  ) as RateDraft;
}

function SettingsLauncherIcon({
  kind,
}: {
  kind: Exclude<SettingsPanel, null>;
}) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    'aria-hidden': true,
  } as const;

  switch (kind) {
    case 'rates':
      return (
        <svg {...common}>
          <path d="M7 17 17 7M8 8h.01M16 16h.01" />
          <circle cx="8" cy="8" r="3" />
          <circle cx="16" cy="16" r="3" />
        </svg>
      );
    case 'receipt':
      return (
        <svg {...common}>
          <path d="M7 3h10v18l-2-1.5L13 21l-2-1.5L9 21l-2-1.5V3Z" />
          <path d="M9.5 8h5M9.5 12h5M9.5 16h3.5" />
        </svg>
      );
    case 'a4-invoice':
      return (
        <svg {...common}>
          <path d="M6 3h9l3 3v15H6V3Z" />
          <path d="M15 3v4h4M9 10h6M9 14h6M9 18h4" />
        </svg>
      );
    case 'sales-ai':
      return (
        <svg {...common}>
          <path d="M8 5h8M8 19h8M5 8v8M19 8v8" />
          <rect x="7" y="7" width="10" height="10" rx="3" />
          <path d="M10 11h.01M14 11h.01M10 14h4" />
        </svg>
      );
    case 'backup':
      return (
        <svg {...common}>
          <path d="M6 4h9l3 3v13H6V4Z" />
          <path d="M9 4v5h6V4M9 15h6M12 12v6" />
        </svg>
      );
    case 'history-reset':
      return (
        <svg {...common}>
          <path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6" />
          <path d="M4 4v4.6h4.6M12 8v4l2.8 1.8" />
        </svg>
      );
    case 'business-reset':
      return (
        <svg {...common}>
          <path d="M12 3 3.8 18h16.4L12 3Z" />
          <path d="M12 9v4M12 16h.01" />
        </svg>
      );
    default:
      return null;
  }
}

export default function SettingsPage() {
  const { appUser } = useAuth();
  if (!appUser?.active) return null;
  return appUser.role === 'owner'
    ? <OwnerSettingsPage key={appUser.uid} />
    : <DeviceSettingsPage key={appUser.uid} />;
}

function OwnerSettingsPage() {
  const { appUser } = useAuth();
  const [activePanel, setActivePanel] = useState<SettingsPanel>(null);
  const [rates, setRates] = useState<RateDraft>(() => toDraft({ ...DEFAULT_QUICK_SERVICE_PROFIT_RATES_PERCENT }));
  const [ratesLoading, setRatesLoading] = useState(true);
  const [ratesReady, setRatesReady] = useState(false);
  const [ratesSaving, setRatesSaving] = useState(false);
  const [ratesError, setRatesError] = useState('');
  const [ratesMessage, setRatesMessage] = useState('');
  const [ratesRetryNonce, setRatesRetryNonce] = useState(0);
  const [retryInFlight, setRetryInFlight] = useState(false);
  const [retryFocusTarget, setRetryFocusTarget] = useState<RetryFocusTarget>(null);
  const retryInFlightRef = useRef(false);
  const retryButtonRef = useRef<HTMLButtonElement>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!appUser || appUser.role !== 'owner') return undefined;
    let retryFocusPending = retryInFlightRef.current;
    const settleExplicitRetry = (target: 'retry' | 'save') => {
      if (!retryFocusPending) return;
      retryFocusPending = false;
      if (target === 'save') {
        saveButtonRef.current?.focus();
      }
      retryInFlightRef.current = false;
      setRetryInFlight(false);
      if (target === 'retry') {
        setRetryFocusTarget('retry');
      }
    };

    setRatesLoading(true);
    setRatesReady(false);
    setRatesError('');
    setRatesMessage('');
    return subscribeQuickServiceProfitRates(
      (next) => {
        setRates(toDraft(next));
        setRatesReady(true);
        setRatesLoading(false);
        setRatesError('');
        settleExplicitRetry('save');
      },
      (error) => {
        setRatesReady(false);
        setRatesLoading(false);
        setRatesError(error.message);
        settleExplicitRetry('retry');
      },
    );
  }, [appUser, ratesRetryNonce]);

  useEffect(() => {
    if (retryFocusTarget === 'retry' && ratesError && !ratesLoading) {
      retryButtonRef.current?.focus();
      setRetryFocusTarget(null);
    }
  }, [retryFocusTarget, ratesLoading, ratesError]);

  if (!appUser || appUser.role !== 'owner') return null;

  function retryRatesLoad() {
    if (ratesLoading) return;
    retryInFlightRef.current = true;
    setRetryInFlight(true);
    setRetryFocusTarget(null);
    setRatesLoading(true);
    setRatesReady(false);
    setRatesError('');
    setRatesMessage('');
    setRatesRetryNonce((value) => value + 1);
  }

  async function handleSaveRates() {
    if (ratesSaving || ratesLoading || !ratesReady) return;
    setRatesSaving(true);
    setRatesError('');
    setRatesMessage('');
    try {
      const parsed = Object.fromEntries(
        QUICK_SERVICE_CATEGORIES.map((category) => {
          const raw = rates[category].trim();
          if (!/^\d+$/.test(raw)) throw new Error(`${QUICK_SERVICE_CATEGORY_LABELS[category]} phải là số nguyên từ 0 đến 100%.`);
          const value = Number(raw);
          if (!Number.isSafeInteger(value) || value < 0 || value > 100) {
            throw new Error(`${QUICK_SERVICE_CATEGORY_LABELS[category]} phải là số nguyên từ 0 đến 100%.`);
          }
          return [category, value];
        }),
      );
      const saved = await saveQuickServiceProfitRates(parsed);
      setRates(toDraft(saved));
      setRatesMessage('Đã lưu tỷ lệ lợi nhuận ước tính cho dịch vụ nhanh. Giao dịch mới sẽ snapshot tỷ lệ tại thời điểm tạo.');
    } catch (cause) {
      setRatesError(cause instanceof Error ? cause.message : 'Không thể lưu tỷ lệ dịch vụ.');
    } finally {
      setRatesSaving(false);
    }
  }

  const closePanel = () => setActivePanel(null);

  return (
    <div className="settings-shell settings-page settings-launcher-page">
      <header className="settings-header">
        <div>
          <p className="eyebrow">QUẢN TRỊ HỆ THỐNG</p>
          <h1>Cài đặt</h1>
          <p className="muted">
            Chọn một mục để mở cửa sổ cài đặt. Mỗi nhóm được tách riêng để thao tác gọn và dễ kiểm soát hơn.
          </p>
        </div>
      </header>

      <section className="settings-launcher-section" aria-labelledby="settings-general-heading">
        <div className="settings-launcher-heading">
          <div>
            <p className="eyebrow">CẤU HÌNH</p>
            <h2 id="settings-general-heading">Cài đặt vận hành</h2>
          </div>
        </div>

        <div className="settings-launcher-grid">
          <button
            id="settings-service-rates"
            className="settings-launcher-card"
            type="button"
            onClick={() => setActivePanel('rates')}
          >
            <span className="settings-launcher-card__icon"><SettingsLauncherIcon kind="rates" /></span>
            <span className="settings-launcher-card__copy">
              <strong>Tỷ lệ lợi nhuận dịch vụ</strong>
              <small>Thiết lập % lợi nhuận ước tính cho 6 dịch vụ nhanh.</small>
            </span>
            <span className="settings-launcher-card__arrow" aria-hidden="true">›</span>
          </button>

          <button
            id="settings-receipt"
            className="settings-launcher-card"
            type="button"
            onClick={() => setActivePanel('receipt')}
          >
            <span className="settings-launcher-card__icon"><SettingsLauncherIcon kind="receipt" /></span>
            <span className="settings-launcher-card__copy">
              <strong>Hóa đơn nhiệt 58/80mm</strong>
              <small>Khổ 7,8 cm/58mm, QR, máy in Windows và in thử.</small>
            </span>
            <span className="settings-launcher-card__arrow" aria-hidden="true">›</span>
          </button>

          <button
            id="settings-a4-invoice"
            className="settings-launcher-card"
            type="button"
            onClick={() => setActivePanel('a4-invoice')}
          >
            <span className="settings-launcher-card__icon"><SettingsLauncherIcon kind="a4-invoice" /></span>
            <span className="settings-launcher-card__copy">
              <strong>Thiết lập hóa đơn A4</strong>
              <small>Mẫu phiếu bán hàng A4 dọc, bảng hàng hóa, tổng tiền, QR và chữ ký.</small>
            </span>
            <span className="settings-launcher-card__arrow" aria-hidden="true">›</span>
          </button>

          <button
            className="settings-launcher-card"
            type="button"
            onClick={() => setActivePanel('sales-ai')}
          >
            <span className="settings-launcher-card__icon"><SettingsLauncherIcon kind="sales-ai" /></span>
            <span className="settings-launcher-card__copy">
              <strong>Sales AI Learning</strong>
              <small>Quản lý cách gọi hàng, mapping và dữ liệu AI đã học.</small>
            </span>
            <span className="settings-launcher-card__arrow" aria-hidden="true">›</span>
          </button>

          <button
            className="settings-launcher-card"
            type="button"
            onClick={() => setActivePanel('backup')}
          >
            <span className="settings-launcher-card__icon"><SettingsLauncherIcon kind="backup" /></span>
            <span className="settings-launcher-card__copy">
              <strong>Sao lưu & khôi phục</strong>
              <small>Tạo bản sao dữ liệu hoặc khôi phục từ bản sao lưu.</small>
            </span>
            <span className="settings-launcher-card__arrow" aria-hidden="true">›</span>
          </button>
        </div>
      </section>

      <section id="settings-danger-zone" className="settings-launcher-section settings-launcher-section--danger" aria-labelledby="settings-data-heading">
        <div className="settings-launcher-heading">
          <div>
            <p className="eyebrow">DỮ LIỆU HỆ THỐNG</p>
            <h2 id="settings-data-heading">Thao tác dữ liệu</h2>
            <p>Hai mục dưới đây có thể xóa dữ liệu. Mỗi thao tác vẫn giữ nguyên bước xác nhận an toàn hiện có.</p>
          </div>
        </div>

        <div className="settings-launcher-grid settings-launcher-grid--danger">
          <button
            className="settings-launcher-card settings-launcher-card--warning"
            type="button"
            onClick={() => setActivePanel('history-reset')}
          >
            <span className="settings-launcher-card__icon"><SettingsLauncherIcon kind="history-reset" /></span>
            <span className="settings-launcher-card__copy">
              <strong>Xóa lịch sử giao dịch</strong>
              <small>Xóa lịch sử theo phạm vi cho phép nhưng giữ danh mục và tồn kho theo quy trình hiện có.</small>
            </span>
            <span className="settings-launcher-card__arrow" aria-hidden="true">›</span>
          </button>

          <button
            className="settings-launcher-card settings-launcher-card--danger"
            type="button"
            onClick={() => setActivePanel('business-reset')}
          >
            <span className="settings-launcher-card__icon"><SettingsLauncherIcon kind="business-reset" /></span>
            <span className="settings-launcher-card__copy">
              <strong>Reset toàn bộ dữ liệu</strong>
              <small>Hard reset dữ liệu kinh doanh theo cơ chế xác nhận an toàn hiện có.</small>
            </span>
            <span className="settings-launcher-card__arrow" aria-hidden="true">›</span>
          </button>
        </div>
      </section>

      <Dialog
        open={activePanel === 'rates'}
        title="Tỷ lệ lợi nhuận dịch vụ"
        onClose={closePanel}
        savingLock={ratesSaving}
      >
        <section className="settings-window-content settings-window-rates" aria-labelledby="quick-service-rates-heading">
          <div className="settings-window-intro">
            <h3 id="quick-service-rates-heading">Tỷ lệ lợi nhuận ước tính</h3>
            <p className="muted">
              Từ 0 đến 100%. Mỗi giao dịch dịch vụ lưu snapshot tỷ lệ đang áp dụng, nên đổi tỷ lệ sau này không làm thay đổi lịch sử.
            </p>
          </div>

          {ratesLoading && !retryInFlight ? <p className="muted">Đang tải tỷ lệ dịch vụ…</p> : null}
          {!ratesLoading && !ratesReady ? <p className="muted">Chưa thể xác nhận cấu hình từ máy chủ. Tỷ lệ hiển thị tạm thời không thể chỉnh sửa hoặc lưu.</p> : null}

          <div className="settings-rate-grid">
            {QUICK_SERVICE_CATEGORIES.map((category) => (
              <label className="settings-rate-field" key={category}>
                <span>{QUICK_SERVICE_CATEGORY_LABELS[category]}</span>
                <span className="settings-rate-input-wrap">
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    max="100"
                    step="1"
                    value={rates[category]}
                    disabled={!ratesReady || ratesLoading || ratesSaving}
                    onChange={(event) => {
                      const nextValue = event.currentTarget.value;
                      setRates((current) => ({ ...current, [category]: nextValue }));
                    }}
                    aria-label={`Tỷ lệ lợi nhuận ước tính ${QUICK_SERVICE_CATEGORY_LABELS[category]}`}
                  />
                  <span aria-hidden="true">%</span>
                </span>
              </label>
            ))}
          </div>

          {ratesError ? <p className="form-error" role="alert">{ratesError}</p> : null}
          {ratesError || retryInFlight ? (
            <button
              ref={retryButtonRef}
              className="button settings-rate-save"
              type="button"
              aria-disabled={ratesLoading}
              aria-busy={ratesLoading}
              onClick={retryRatesLoad}
            >
              {ratesLoading ? 'Đang thử lại…' : 'Thử lại'}
            </button>
          ) : null}
          {ratesMessage ? <p className="settings-success" role="status">{ratesMessage}</p> : null}
          <button
            ref={saveButtonRef}
            className="button button--primary settings-rate-save"
            type="button"
            aria-disabled={ratesLoading || ratesSaving || !ratesReady}
            aria-busy={ratesSaving}
            onClick={() => void handleSaveRates()}
          >
            {ratesSaving ? 'Đang lưu…' : 'Lưu tỷ lệ dịch vụ'}
          </button>
        </section>
      </Dialog>

      <Dialog
        open={activePanel === 'receipt'}
        title="Hóa đơn nhiệt 58/80mm"
        onClose={closePanel}
      >
        <div className="settings-window-content">
          <ReceiptSettingsPanel />
        </div>
      </Dialog>

      <Dialog
        open={activePanel === 'a4-invoice'}
        title="Thiết lập hóa đơn A4"
        onClose={closePanel}
      >
        <div className="settings-window-content">
          <A4InvoiceSettingsPanel />
        </div>
      </Dialog>

      <Dialog
        open={activePanel === 'sales-ai'}
        title="Sales AI Learning"
        onClose={closePanel}
      >
        <div className="settings-window-content settings-window-embedded">
          <SalesAiLearningPanel actorUid={appUser.uid} />
        </div>
      </Dialog>

      <Dialog
        open={activePanel === 'backup'}
        title="Sao lưu & khôi phục"
        onClose={closePanel}
      >
        <div className="settings-window-content settings-window-embedded">
          <BackupPanel actorUid={appUser.uid} />
        </div>
      </Dialog>

      <Dialog
        open={activePanel === 'history-reset'}
        title="Xóa lịch sử giao dịch"
        onClose={closePanel}
      >
        <div className="settings-window-content settings-window-embedded">
          <TransactionHistoryResetPanel actorUid={appUser.uid} />
        </div>
      </Dialog>

      <Dialog
        open={activePanel === 'business-reset'}
        title="Reset toàn bộ dữ liệu"
        onClose={closePanel}
      >
        <div className="settings-window-content settings-window-embedded">
          <BusinessDataResetPanel actorUid={appUser.uid} />
        </div>
      </Dialog>
    </div>
  );
}
