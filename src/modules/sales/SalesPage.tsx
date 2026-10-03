import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../auth/AuthContext';
import { hasModulePermission } from '../../auth/permissions';
import PosCashExpense, {
  type CashExpenseHandle,
  type CashExpenseStatus,
} from './PosCashExpense';
import { openCashDrawerAfterTransaction } from './cashDrawerClient';
import VndMoneyInput from '../../shared/numeric/VndMoneyInput';
import {
  playScanSuccessFeedback,
  primeScanSuccessFeedback,
} from '../../shared/audio/scanSuccessFeedback';
import { searchProducts } from '../../shared/search/productSearch';
import type {
  Category,
  Customer,
  PaymentMethod,
  Product,
  Sale,
} from '../../types/models';
import ProductThumbnail from '../products/ProductThumbnail';
import { subscribeProducts } from '../products/productService';
import { subscribeCategories } from '../products/categoryService';
import BarcodeScanner from '../qr/BarcodeScanner';
import { findProductByScannedCode } from '../qr/productLookup';
import ReceiptPrintControl from '../printing/ReceiptPrintControl';
import SaleHistoryPage from './SaleHistoryPage';
import ProductNameMarquee from './ProductNameMarquee';
import PosActionIcon from './PosActionIcon';
import {
  getRecentSales,
  parseCashExpenseAmount,
  summarizeRecentSale,
} from './salesPosUi';
import {
  createSale,
  createSaleId,
  subscribeCustomers,
  subscribeSales,
} from './salesService';
import './sales.css';
import './salesPosOverrides.css';
import './salesUnifiedSearch.css';
import './posCashExpense.css';
import './productPos.css';

type CartState = Record<string, number>;
type PosPaymentMethod = Extract<PaymentMethod, 'cash' | 'bank_transfer'>;

type SavedDraft = {
  cart?: CartState;
  discount?: number;
  paymentMethod?: PaymentMethod;
  customerId?: string;
  note?: string;
  pendingSaleId?: string;
};

const DRAFT_STORAGE_KEY = 'ban-tap-hoa.sales-pos-draft.v1';

function formatMoney(value: number) {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(
    value,
  );
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
}

function roundQuantity(value: number) {
  return Math.round(value * 1000) / 1000;
}

function writeSavedDraft(draft: SavedDraft) {
  localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
}

function readSavedDraft(): Required<SavedDraft> {
  const fallback = {
    cart: {},
    discount: 0,
    paymentMethod: 'cash' as PaymentMethod,
    customerId: '',
    note: '',
    pendingSaleId: '',
  };

  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as SavedDraft;
    const cart =
      parsed.cart && typeof parsed.cart === 'object'
        ? Object.fromEntries(
            Object.entries(parsed.cart)
              .map(
                ([productId, quantity]) =>
                  [productId, roundQuantity(Number(quantity))] as const,
              )
              .filter(
                ([productId, quantity]) =>
                  Boolean(productId) &&
                  Number.isFinite(quantity) &&
                  quantity > 0,
              ),
          )
        : {};
    return {
      cart,
      discount:
        Number.isFinite(Number(parsed.discount)) && Number(parsed.discount) >= 0
          ? Math.round(Number(parsed.discount))
          : 0,
      paymentMethod:
        parsed.paymentMethod === 'bank_transfer' ? 'bank_transfer' : 'cash',
      customerId:
        typeof parsed.customerId === 'string' ? parsed.customerId : '',
      note: typeof parsed.note === 'string' ? parsed.note : '',
      pendingSaleId:
        typeof parsed.pendingSaleId === 'string' ? parsed.pendingSaleId : '',
    };
  } catch {
    return fallback;
  }
}

export default function SalesPage() {
  const { appUser } = useAuth();
  const initialDraft = useMemo(() => readSavedDraft(), []);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const invoiceCardRef = useRef<HTMLElement>(null);
  const quickAmountCardRef = useRef<HTMLDivElement>(null);
  const quickAmountInputRef = useRef<HTMLInputElement>(null);
  const checkoutSubmitRef = useRef(false);
  const manualDrawerRef = useRef(false);
  const paymentGridRef = useRef<HTMLDivElement>(null);
  const productPagesRef = useRef<HTMLDivElement>(null);
  const cartLineRefs = useRef(new Map<string, HTMLElement>());
  const historyBackButtonRef = useRef<HTMLButtonElement>(null);
  const recentHeadingRef = useRef<HTMLHeadingElement>(null);
  const saleNoticeTimerRef = useRef<number | null>(null);
  const saleNoticeIdRef = useRef<string | null>(null);
  const draftSaveTimerRef = useRef<number | null>(null);
  const latestDraftRef = useRef<SavedDraft>({});
  const [view, setView] = useState<'pos' | 'history'>('pos');
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [recentSales, setRecentSales] = useState<Sale[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [customerError, setCustomerError] = useState<string | null>(null);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [dataRetryNonce, setDataRetryNonce] = useState(0);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartState>(initialDraft.cart);
  const [discount, setDiscount] = useState(initialDraft.discount);
  const [paymentMethod, setPaymentMethod] = useState<PosPaymentMethod>(
    initialDraft.paymentMethod === 'bank_transfer' ? 'bank_transfer' : 'cash',
  );
  const [customerId, setCustomerId] = useState(initialDraft.customerId);
  const [note, setNote] = useState(initialDraft.note);
  const [cashExpenseActive, setCashExpenseActive] = useState(false);
  const [cashExpenseLocked, setCashExpenseLocked] = useState(false);
  const cashExpenseRef = useRef<CashExpenseHandle>(null);
  const [cashExpenseAmount, setCashExpenseAmount] = useState('');
  const [cashExpenseNote, setCashExpenseNote] = useState('');
  const [cashExpenseStatus, setCashExpenseStatus] = useState<CashExpenseStatus>(
    { saving: false, pending: null },
  );
  const resetCashExpenseDraft = useCallback(() => {
    setCashExpenseAmount('');
    setCashExpenseNote('');
  }, []);
  const handleCashExpenseNotice = useCallback(
    (notice: string | null, error: string | null) => {
      setLastCompletedSale(null);
      setMessage(notice);
      setCheckoutError(error);
      if (notice) scheduleSaleNoticeExpiry(`expense-${Date.now()}`);
    },
    [],
  );
  const [pendingSaleId, setPendingSaleId] = useState(
    initialDraft.pendingSaleId,
  );
  const fastDiscountRef = useRef(initialDraft.discount);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [manualDrawerBusy, setManualDrawerBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lastCompletedSale, setLastCompletedSale] = useState<Sale | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [draftMessage, setDraftMessage] = useState('');
  const [online, setOnline] = useState(() => navigator.onLine);
  const [topbarNotificationHost, setTopbarNotificationHost] =
    useState<HTMLElement | null>(null);
  const [tabletPosLayout, setTabletPosLayout] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(min-width: 761px) and (max-width: 1180px)').matches,
  );
  const [widePosLayout, setWidePosLayout] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(min-width: 761px)').matches,
  );
  const cashExpenseAvailable = Boolean(
    appUser?.active && hasModulePermission(appUser, 'expenses'),
  );
  useEffect(() => {
    resetCashExpenseDraft();
  }, [appUser?.uid, resetCashExpenseDraft]);

  useEffect(() => {
    setTopbarNotificationHost(
      document.getElementById('topbar-notification-slot'),
    );
  }, []);

  useEffect(() => {
    fastDiscountRef.current = discount;
  }, [discount]);

  useEffect(() => {
    const media = window.matchMedia(
      '(min-width: 761px) and (max-width: 1180px)',
    );
    const syncTabletLayout = () => setTabletPosLayout(media.matches);
    syncTabletLayout();
    media.addEventListener('change', syncTabletLayout);
    return () => media.removeEventListener('change', syncTabletLayout);
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 761px)');
    const syncWideLayout = () => setWidePosLayout(media.matches);
    syncWideLayout();
    media.addEventListener('change', syncWideLayout);
    return () => media.removeEventListener('change', syncWideLayout);
  }, []);

  useEffect(() => {
    setProductsLoading(true);
    setProductsError(null);
    try {
      const unsubscribe = subscribeProducts(
        (next) => {
          setProducts(next);
          setProductsLoading(false);
        },
        (cause) => {
          setProductsError(cause.message);
          setProductsLoading(false);
        },
      );
      return unsubscribe;
    } catch (cause) {
      setProductsError(
        cause instanceof Error ? cause.message : 'Không thể tải sản phẩm.',
      );
      setProductsLoading(false);
      return undefined;
    }
  }, [dataRetryNonce]);

  useEffect(() => {
    try {
      return subscribeCategories(setCategories, () => undefined);
    } catch {
      return undefined;
    }
  }, [dataRetryNonce]);

  useEffect(() => {
    setCustomerError(null);
    try {
      return subscribeCustomers(setCustomers, (cause) =>
        setCustomerError(cause.message),
      );
    } catch (cause) {
      setCustomerError(
        cause instanceof Error ? cause.message : 'Không thể tải khách hàng.',
      );
      return undefined;
    }
  }, [dataRetryNonce]);

  useEffect(() => {
    setRecentError(null);
    try {
      return subscribeSales(
        { limit: 20 },
        (next) => setRecentSales(getRecentSales(next, 4)),
        (cause) => setRecentError(cause.message),
      );
    } catch (cause) {
      setRecentError(
        cause instanceof Error
          ? cause.message
          : 'Không thể tải giao dịch gần đây.',
      );
      return undefined;
    }
  }, [dataRetryNonce]);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(
    () => () => {
      if (saleNoticeTimerRef.current !== null)
        window.clearTimeout(saleNoticeTimerRef.current);
      if (draftSaveTimerRef.current !== null) {
        window.clearTimeout(draftSaveTimerRef.current);
        writeSavedDraft(latestDraftRef.current);
        draftSaveTimerRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    const nextDraft: SavedDraft = {
      cart,
      discount,
      paymentMethod,
      customerId,
      note,
      pendingSaleId,
    };

    latestDraftRef.current = nextDraft;

    if (draftSaveTimerRef.current !== null) {
      window.clearTimeout(draftSaveTimerRef.current);
    }

    draftSaveTimerRef.current = window.setTimeout(() => {
      writeSavedDraft(latestDraftRef.current);
      draftSaveTimerRef.current = null;
    }, 250);

    return () => {
      if (draftSaveTimerRef.current !== null) {
        window.clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
    };
  }, [cart, discount, paymentMethod, customerId, note, pendingSaleId]);

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'F3') return;
      event.preventDefault();
      setView('pos');
      requestAnimationFrame(() => searchInputRef.current?.focus());
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  const activeProducts = useMemo(
    () => products.filter((product) => product.active === true),
    [products],
  );
  const searchResults = useMemo(
    () =>
      search.trim()
        ? searchProducts(activeProducts, search, { limit: 8, categories })
        : [],
    [activeProducts, search, categories],
  );
  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );
  const cartLines = useMemo(
    () =>
      Object.entries(cart).map(([productId, quantity]) => ({
        productId,
        quantity,
        product: productById.get(productId),
      })),
    [cart, productById],
  );
  const tabletCartLines = useMemo(
    () => cartLines.filter((line) => Boolean(line.product)),
    [cartLines],
  );
  const tabletCartPages = useMemo(
    () =>
      Array.from(
        { length: Math.ceil(tabletCartLines.length / 6) },
        (_, pageIndex) =>
          tabletCartLines.slice(pageIndex * 6, pageIndex * 6 + 6),
      ),
    [tabletCartLines],
  );

  useEffect(() => {
    if (!widePosLayout || tabletCartLines.length <= 6) return;
    const pages = productPagesRef.current;
    if (!pages) return;

    const frame = window.requestAnimationFrame(() => {
      const targetLeft = Math.max(0, pages.scrollWidth - pages.clientWidth);
      pages.scrollTo({ left: targetLeft, behavior: 'smooth' });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [tabletCartLines.length, widePosLayout]);
  const subtotal = useMemo(
    () =>
      cartLines.reduce((sum, line) => {
        if (!line.product || !Number.isFinite(Number(line.product.salePrice)))
          return sum;
        return sum + Math.round(line.quantity * Number(line.product.salePrice));
      }, 0),
    [cartLines],
  );
  const cashExpenseMode = cashExpenseAvailable && cashExpenseActive;
  const parsedCashExpenseAmount = parseCashExpenseAmount(cashExpenseAmount);
  const cashExpenseAmountVnd =
    parsedCashExpenseAmount.state === 'valid'
      ? parsedCashExpenseAmount.amount
      : 0;
  const cashExpenseInputLocked =
    cashExpenseLocked ||
    cashExpenseStatus.saving ||
    Boolean(cashExpenseStatus.pending);
  const shownNote = cashExpenseMode ? cashExpenseNote : note;
  const changeShownNote = cashExpenseMode ? setCashExpenseNote : setNote;
  const hasProductIntent = cartLines.length > 0;
  const amountInputDisabled = cashExpenseMode
    ? cashExpenseInputLocked || submitting || !online
    : !hasProductIntent || Boolean(pendingSaleId) || submitting;
  const payable = Math.max(0, subtotal - discount);

  const cartIssues = useMemo(
    () =>
      cartLines.flatMap((line) => {
        const product = line.product;
        if (!product) return [`Sản phẩm ${line.productId} không còn tồn tại.`];
        if (product.active !== true)
          return [`${product.sku} - ${product.name} đã ngừng hoạt động.`];
        if (!Number.isFinite(line.quantity) || line.quantity <= 0)
          return [`Số lượng ${product.name} không hợp lệ.`];
        if (line.quantity > Number(product.stockQuantity || 0)) {
          return [
            `${product.sku} - ${product.name}: giỏ ${formatQuantity(line.quantity)}, tồn hiện tại ${formatQuantity(Number(product.stockQuantity || 0))}.`,
          ];
        }
        if (
          !Number.isFinite(Number(product.salePrice)) ||
          Number(product.salePrice) < 0
        ) {
          return [`Giá bán ${product.name} không hợp lệ.`];
        }
        return [];
      }),
    [cartLines],
  );

  const scrollProductIntoCheckout = useCallback((productId: string) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const target =
          cartLineRefs.current.get(productId) ?? invoiceCardRef.current;
        if (!target) return;
        target.focus({ preventScroll: true });
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
          inline: 'nearest',
        });
      });
    });
  }, []);

  const scrollBackToSalesStart = useCallback(() => {
    quickAmountInputRef.current?.blur();
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }, []);

  const addProduct = useCallback((product: Product) => {
    setCheckoutError(null);
    setMessage(null);
    setDraftMessage('');
    if (!product.active) {
      setCheckoutError(`${product.sku} - ${product.name} đã ngừng hoạt động.`);
      return;
    }
    const stock = Number(product.stockQuantity) || 0;
    if (stock <= 0) {
      setCheckoutError(`${product.sku} - ${product.name} đã hết hàng.`);
      return;
    }
    setCart((current) => {
      const nextQuantity = roundQuantity((current[product.id] ?? 0) + 1);
      if (nextQuantity > stock) {
        setCheckoutError(
          `Không thể thêm vượt tồn hiện tại (${formatQuantity(stock)} ${product.unit || ''}).`,
        );
        return current;
      }
      return { ...current, [product.id]: nextQuantity };
    });
  }, []);

  function writeQuickAmountVisual(value: string) {
    const input = quickAmountInputRef.current;
    if (input && input.value !== value) input.value = value;
  }

  function appendQuickAmountDigit(digit: string) {
    if (cashExpenseMode) {
      if (cashExpenseInputLocked || submitting || !online) return;
      setCashExpenseAmount((current) =>
        (current.replace(/\D/g, '') + digit).slice(0, 9),
      );
      setCheckoutError(null);
      return;
    }
    if (hasProductIntent) {
      if (pendingSaleId) return;
      const current = Math.max(0, Math.round(fastDiscountRef.current));
      const digits = String(current).replace(/\D/g, '');
      const base = current > 0 ? digits : '';
      const next = Number((base + digit).slice(0, 9) || 0);
      fastDiscountRef.current = next;
      writeQuickAmountVisual(next > 0 ? String(next) : '');
      setDiscount(next);
      setCheckoutError(null);
      return;
    }
  }

  function removeQuickAmountDigit() {
    if (cashExpenseMode) {
      if (cashExpenseInputLocked || submitting || !online) return;
      setCashExpenseAmount((current) => current.slice(0, -1));
      setCheckoutError(null);
      return;
    }
    if (hasProductIntent) {
      if (pendingSaleId) return;
      const digits = String(
        Math.max(0, Math.round(fastDiscountRef.current)),
      ).replace(/\D/g, '');
      const next = Number(digits.slice(0, -1) || 0);
      fastDiscountRef.current = next;
      writeQuickAmountVisual(next > 0 ? String(next) : '');
      setDiscount(next);
      setCheckoutError(null);
      return;
    }
  }

  function clearQuickAmount() {
    if (cashExpenseMode) {
      if (cashExpenseInputLocked || submitting || !online) return;
      setCashExpenseAmount('');
      setCheckoutError(null);
      return;
    }
    if (hasProductIntent) {
      if (pendingSaleId) return;
      fastDiscountRef.current = 0;
      writeQuickAmountVisual('');
      setDiscount(0);
      setCheckoutError(null);
      return;
    }
  }

  function handleNumpadPointerDown(
    event: PointerEvent<HTMLButtonElement>,
    action: () => void,
  ) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    action();
  }

  function setLineQuantity(product: Product, value: number) {
    setCheckoutError(null);
    setMessage(null);
    setDraftMessage('');
    const quantity = roundQuantity(value);
    if (!Number.isFinite(quantity)) return;
    if (quantity <= 0) {
      setCart((current) => {
        const next = { ...current };
        delete next[product.id];
        return next;
      });
      return;
    }
    const stock = Number(product.stockQuantity) || 0;
    if (quantity > stock) {
      setCheckoutError(
        `Không thể bán ${formatQuantity(quantity)} ${product.unit || ''}; tồn hiển thị hiện tại là ${formatQuantity(stock)}.`,
      );
      return;
    }
    setCart((current) => ({ ...current, [product.id]: quantity }));
  }

  function removeLine(productId: string) {
    setCart((current) => {
      const next = { ...current };
      delete next[productId];
      return next;
    });
    setCheckoutError(null);
    setMessage(null);
    setDraftMessage('');
  }

  function clearProductOrder() {
    setCart({});
    setDiscount(0);
    setPendingSaleId('');
    setCheckoutError(null);
    setMessage(null);
    setDraftMessage('');
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    const query = search.trim();
    if (!query) {
      event.preventDefault();
      return;
    }

    const exactCode = searchResults.find(
      (result) =>
        result.kind === 'exact-qr' ||
        result.kind === 'exact-barcode' ||
        result.kind === 'exact-sku',
    );
    const singleDeterministic =
      searchResults.length === 1 && !searchResults[0].kind.startsWith('fuzzy-')
        ? searchResults[0]
        : undefined;
    const targetResult = exactCode ?? singleDeterministic;

    event.preventDefault();
    if (!targetResult) return;
    const target = targetResult.product;
    addProduct(target);
    setSearch('');
    searchInputRef.current?.blur();
    scrollProductIntoCheckout(target.id);
  }

  function closeScanner(restoreSearchFocus = true) {
    setScannerOpen(false);
    if (restoreSearchFocus)
      requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function toggleScanner() {
    if (scannerOpen) {
      closeScanner();
      return;
    }
    void primeScanSuccessFeedback();
    setScannerOpen(true);
  }

  function openHistory() {
    setView('history');
    requestAnimationFrame(() => historyBackButtonRef.current?.focus());
  }

  function returnToPos() {
    setView('pos');
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function handleCameraScan(value: string) {
    const match = findProductByScannedCode(activeProducts, value);
    if (!match) {
      setCheckoutError(`Không tìm thấy sản phẩm cho mã “${value}”.`);
      return;
    }
    addProduct(match.product);
    playScanSuccessFeedback();
    setSearch('');
    closeScanner(false);
    scrollProductIntoCheckout(match.product.id);
  }

  async function handleManualDrawerOpen() {
    if (
      !cashExpenseAvailable ||
      submitting ||
      checkoutSubmitRef.current ||
      cashExpenseLocked ||
      manualDrawerRef.current
    )
      return;
    manualDrawerRef.current = true;
    setManualDrawerBusy(true);
    setCheckoutError(null);
    setDraftMessage('');
    try {
      const warning = await openCashDrawerAfterTransaction(
        `POS_MANUAL_${crypto.randomUUID()}`,
        'manual',
      );
      if (warning) setCheckoutError(warning);
      else setDraftMessage('Đã gửi lệnh mở két. Vui lòng kiểm tra két.');
    } finally {
      manualDrawerRef.current = false;
      setManualDrawerBusy(false);
    }
  }

  function handleSaveDraft() {
    writeSavedDraft({
      cart,
      discount,
      paymentMethod,
      customerId,
      note,
      pendingSaleId,
    });
    setDraftMessage(
      'Đã lưu tạm trên thiết bị này. Dữ liệu tạm không đồng bộ sang thiết bị khác.',
    );
    setCheckoutError(null);
  }

  function formatCompletedSaleNotice(sale: Sale) {
    return `${sale.items.map((item) => `${item.name} · SKU ${item.sku}`).join(' / ')} · Thành tiền ${formatMoney(sale.total)}`;
  }

  function scheduleSaleNoticeExpiry(saleId: string) {
    saleNoticeIdRef.current = saleId;
    if (saleNoticeTimerRef.current !== null) {
      window.clearTimeout(saleNoticeTimerRef.current);
    }
    saleNoticeTimerRef.current = window.setTimeout(() => {
      if (saleNoticeIdRef.current !== saleId) return;
      saleNoticeIdRef.current = null;
      saleNoticeTimerRef.current = null;
      setMessage(null);
      setLastCompletedSale(null);
    }, 120_000);
  }

  async function handleCheckout(nextPaymentMethod: PosPaymentMethod) {
    if (cashExpenseMode) {
      if (!appUser || submitting || cashExpenseStatus.saving || !online) return;
      await cashExpenseRef.current?.submit(nextPaymentMethod);
      return;
    }
    if (
      !appUser ||
      submitting ||
      checkoutSubmitRef.current ||
      (cashExpenseAvailable && cashExpenseActive)
    )
      return;
    setPaymentMethod(nextPaymentMethod);
    setCheckoutError(null);
    setMessage(null);
    setDraftMessage('');

    if (!online) {
      setCheckoutError(
        'Thiết bị đang offline. Hãy kết nối mạng trước khi chốt đơn để tránh giao dịch chưa đồng bộ.',
      );
      return;
    }
    if (!hasProductIntent) {
      setCheckoutError('Chưa có hàng hóa để thanh toán.');
      return;
    }
    if (cartIssues.length > 0) {
      setCheckoutError(cartIssues[0]);
      return;
    }
    if (discount < 0 || discount > subtotal) {
      setCheckoutError('Giảm giá phải từ 0 đến tổng tiền hàng.');
      return;
    }

    checkoutSubmitRef.current = true;
    let saleId = pendingSaleId;
    try {
      if (!saleId) {
        saleId = createSaleId();
        setPendingSaleId(saleId);
      }
      setSubmitting(true);
      const sale = await createSale(
        {
          saleId,
          items: cartLines.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
          })),
          discount,
          paymentMethod: nextPaymentMethod,
          ...(customerId ? { customerId } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        appUser.uid,
      );

      const drawerWarning =
        nextPaymentMethod === 'cash'
          ? await openCashDrawerAfterTransaction(
              `POS_PRODUCT_${sale.id}`,
              'product',
            )
          : null;
      setCheckoutError(drawerWarning);
      setLastCompletedSale(sale);
      setMessage(formatCompletedSaleNotice(sale));
      scheduleSaleNoticeExpiry(sale.id);
      setCart({});
      setDiscount(0);
      setPaymentMethod('cash');
      setCustomerId('');
      setNote('');
      setPendingSaleId('');
      setSearch('');
      scrollBackToSalesStart();
    } catch (cause) {
      setCheckoutError(
        `${cause instanceof Error ? cause.message : 'Không thể tạo đơn bán.'} ` +
          'Nếu bấm thử lại, hệ thống sẽ dùng lại cùng mã nghiệp vụ để không trừ tồn hai lần.',
      );
    } finally {
      checkoutSubmitRef.current = false;
      setSubmitting(false);
    }
  }

  if (view === 'history') {
    return (
      <div className="sales-shell">
        <div className="sales-history-backbar">
          <button
            ref={historyBackButtonRef}
            className="sales-secondary-button"
            type="button"
            onClick={returnToPos}
          >
            ← Quay lại POS
          </button>
        </div>
        <SaleHistoryPage />
      </div>
    );
  }

  return (
    <>
      {topbarNotificationHost
        ? createPortal(
            <div className="sales-topbar-notices" aria-live="polite">
              {customerError ? (
                <div className="sales-inline-warning">
                  Không tải được danh sách khách hàng; vẫn có thể bán cho khách
                  lẻ.
                </div>
              ) : null}
              {checkoutError ? (
                <div className="sales-error" role="alert">
                  <span>{checkoutError}</span>
                </div>
              ) : null}
              {cartIssues.length > 0 ? (
                <div className="sales-warning" role="status">
                  <strong>Hóa đơn cần cập nhật trước khi thanh toán:</strong>
                  <span>{cartIssues[0]}</span>
                </div>
              ) : null}
              {draftMessage ? (
                <div className="sales-success" role="status">
                  {draftMessage}
                </div>
              ) : null}
              {message ? (
                <div
                  className={`sales-success${lastCompletedSale ? ' sales-order-notice' : ''}`}
                  role="status"
                >
                  <span
                    className={
                      lastCompletedSale
                        ? 'sales-order-notice__summary'
                        : undefined
                    }
                  >
                    {message}
                  </span>
                  {lastCompletedSale ? (
                    <ReceiptPrintControl
                      sale={lastCompletedSale}
                      creatorName={appUser?.displayName}
                      compact
                      preferA4
                    />
                  ) : null}
                </div>
              ) : null}
            </div>,
            topbarNotificationHost,
          )
        : null}
      <div className="sales-shell sales-pos-shell">
        <section
          className="sales-pos-context"
          aria-label="Thông tin phiên bán hàng"
        >
          <div>
            <span className="sales-pos-context__label">Bán hàng nhanh</span>
            <strong>{appUser?.displayName || 'Nhân viên'}</strong>
          </div>
          <span
            className={`sales-connectivity ${online ? 'sales-connectivity--online' : 'sales-connectivity--offline'}`}
          >
            {online ? 'Trực tuyến' : 'Mất kết nối'}
          </span>
        </section>

        {search ? (
          <div
            className="sales-search-dismiss-layer"
            aria-hidden="true"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setSearch('');
              searchInputRef.current?.blur();
            }}
          />
        ) : null}

        <section className="sales-search-area" aria-label="Tìm hàng hóa">
          <div className="sales-search-row sales-unified-search-row">
            <div className="sales-search-box">
              <span className="sales-search-icon" aria-hidden="true">
                <PosActionIcon name="search" />
              </span>
              <input
                ref={searchInputRef}
                autoComplete="off"
                inputMode="search"
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                }}
                onKeyDown={handleSearchKeyDown}
                placeholder="Tìm hàng theo tên, SKU, barcode hoặc QR… (F3)"
                aria-label="Tìm hàng hóa bằng tên, SKU, barcode hoặc QR"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Xóa tìm kiếm"
                >
                  ×
                </button>
              ) : null}
            </div>
            <button
              className={`sales-scan-button${scannerOpen ? ' is-active' : ''}`}
              type="button"
              aria-expanded={scannerOpen}
              onClick={toggleScanner}
            >
              <PosActionIcon name="qrScanner" />
              <strong>Quét mã</strong>
            </button>
          </div>
          {productsError ? (
            <div className="sales-error" role="alert">
              <span>{productsError}</span>
              <button
                type="button"
                onClick={() => setDataRetryNonce((value) => value + 1)}
              >
                Thử lại
              </button>
            </div>
          ) : null}

          <div className="sales-search-overlay-stack">
            {search ? (
              <div
                className="sales-search-results"
                aria-label="Kết quả tìm hàng hóa"
              >
                {productsLoading ? (
                  <div className="sales-empty">Đang tải sản phẩm...</div>
                ) : searchResults.length === 0 ? (
                  <div className="sales-empty">
                    Không tìm thấy hàng hóa phù hợp.
                  </div>
                ) : (
                  searchResults.map(({ product, kind }) => {
                    const outOfStock = Number(product.stockQuantity) <= 0;
                    return (
                      <button
                        type="button"
                        className="sales-search-result"
                        key={product.id}
                        disabled={outOfStock}
                        onClick={() => {
                          addProduct(product);
                          setSearch('');
                          searchInputRef.current?.blur();
                          scrollProductIntoCheckout(product.id);
                        }}
                      >
                        <ProductThumbnail
                          product={product}
                          className="sales-product-thumb sales-product-thumb--image"
                        />
                        <span className="sales-search-result__identity">
                          <ProductNameMarquee name={product.name} continuous />
                          <small>
                            {product.sku}
                            {product.barcode ? ` · ${product.barcode}` : ''}
                          </small>
                        </span>
                        <span className="sales-search-result__meta">
                          <strong>
                            {formatMoney(Number(product.salePrice) || 0)}
                          </strong>
                          <small>
                            {outOfStock
                              ? 'Hết hàng'
                              : `Tồn ${formatQuantity(Number(product.stockQuantity) || 0)}`}{' '}
                            · {kind}
                          </small>
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            ) : null}
          </div>

          {scannerOpen ? (
            <div className="sales-scanner-panel">
              <div className="sales-scanner-panel__head">
                <div>
                  <strong>Quét QR / barcode</strong>
                  <span>Quét thành công sẽ thêm Product vào hóa đơn.</span>
                </div>
                <button type="button" onClick={() => closeScanner()}>
                  Đóng
                </button>
              </div>
              <BarcodeScanner
                onScan={(result) => handleCameraScan(result.value)}
              />
            </div>
          ) : null}
        </section>

        {widePosLayout && tabletCartLines.length > 0 ? (
        <section
          className={`sales-service-grid${widePosLayout && tabletCartLines.length > 0 ? ' sales-service-grid--products' : ''}`}
          aria-label={
            widePosLayout && tabletCartLines.length > 0
              ? 'Hàng hóa đang chọn'
              : 'Hàng hóa đang chọn'
          }
        >
          {widePosLayout && tabletCartLines.length > 0 ? (
            <div
              ref={productPagesRef}
              className="sales-selected-product-pages"
              aria-label={`${tabletCartLines.length} hàng hóa đang chọn, vuốt ngang để xem thêm`}
            >
              {tabletCartPages.map((page, pageIndex) => (
                <div
                  className="sales-selected-product-page"
                  key={page[0]?.productId ?? `page-${pageIndex}`}
                  aria-label={`Trang sản phẩm ${pageIndex + 1} trên ${tabletCartPages.length}`}
                >
                  {page.map((line) => {
                    const product = line.product!;
                    return (
                      <div
                        key={product.id}
                        className="sales-selected-product-tile"
                      >
                        <button
                          type="button"
                          className="sales-selected-product-tile__open"
                          aria-label={`${product.name}, ${formatMoney(Number(product.salePrice) || 0)}, số lượng ${formatQuantity(line.quantity)}`}
                          onClick={() => scrollProductIntoCheckout(product.id)}
                        />
                        <button
                          type="button"
                          className="sales-selected-product-tile__remove"
                          aria-label={`Xóa ${product.name} khỏi hóa đơn`}
                          onClick={() => removeLine(product.id)}
                        >
                          ×
                        </button>
                        <ProductThumbnail
                          product={product}
                          className="sales-selected-product-tile__image"
                          eager
                        />
                        <span className="sales-selected-product-tile__name">
                          <ProductNameMarquee name={product.name} continuous />
                        </span>
                        <strong className="sales-selected-product-tile__price">
                          {formatMoney(Number(product.salePrice) || 0)}
                        </strong>
                        <span className="sales-selected-product-tile__qty">
                          ×{formatQuantity(line.quantity)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            <div className="sales-empty">
              Quét mã hoặc tìm hàng để thêm vào hóa đơn.
            </div>
          )}
        </section>
        ) : null}

        <div className="sales-note-field sales-note-field--tablet sales-cash-expense-slot">
          {cashExpenseAvailable && appUser ? (
            <PosCashExpense
              key={appUser.uid}
              ref={cashExpenseRef}
              amount={cashExpenseAmountVnd}
              note={cashExpenseNote}
              onReset={resetCashExpenseDraft}
              onStatusChange={setCashExpenseStatus}
              actorUid={appUser.uid}
              active={cashExpenseActive}
              disabled={submitting || !online}
              onActiveChange={setCashExpenseActive}
              onLockChange={setCashExpenseLocked}
              onNotice={handleCashExpenseNotice}
            />
          ) : null}
          {widePosLayout && (cashExpenseMode || hasProductIntent) ? (
            <label className="sales-cash-expense-service-note">
              <span className="sales-field-heading">
                <span aria-hidden="true">▧</span>
                <strong>
                  {cashExpenseMode
                    ? 'Ghi chú / lý do xuất tiền (không bắt buộc)'
                    : 'Ghi chú / địa chỉ khách (không bắt buộc)'}
                </strong>
              </span>
              <textarea
                rows={2}
                maxLength={200}
                value={shownNote}
                disabled={cashExpenseMode && cashExpenseInputLocked}
                onChange={(event) => changeShownNote(event.target.value)}
                placeholder={
                  cashExpenseMode
                    ? 'Nhập lý do xuất tiền…'
                    : 'Nhập ghi chú, địa chỉ giao hàng / địa chỉ khách...'
                }
              />
              <small>{shownNote.length}/200</small>
            </label>
          ) : null}
        </div>

        <div className="sales-invoice-overview--tablet">
          <div
            className="sales-invoice-title sales-invoice-title--tablet"
            aria-label="Thông tin hóa đơn hiện tại"
          >
            <span className="sales-invoice-icon" aria-hidden="true">
              ▤
            </span>
            <div>
              <strong>Hóa đơn 1</strong>
              <span>{cartLines.length} mặt hàng{pendingSaleId ? ' · đang giữ mã thử lại' : ''}</span>
            </div>
          </div>

          <label
            className="sales-customer-picker sales-customer-picker--tablet"
            aria-label="Chọn khách hàng"
          >
            <select
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
            >
              <option value="">Khách lẻ</option>
              {customers.map((customer) => (
                <option value={customer.id} key={customer.id}>
                  {customer.name}
                  {customer.phone ? ` · ${customer.phone}` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>

        <section
          ref={invoiceCardRef}
          tabIndex={-1}
          className="sales-invoice-card"
          aria-labelledby="sales-invoice-heading"
        >
          <div className="sales-invoice-header">
            <div className="sales-invoice-title sales-invoice-title--invoice">
              <span className="sales-invoice-icon" aria-hidden="true">
                ▤
              </span>
              <div>
                <h1 id="sales-invoice-heading">Hóa đơn 1</h1>
                <span>{cartLines.length} mặt hàng{pendingSaleId ? ' · đang giữ mã thử lại' : ''}</span>
              </div>
            </div>

            <label className="sales-customer-picker">
              <span>Thêm / chọn khách hàng</span>
              <select
                value={customerId}
                onChange={(event) => setCustomerId(event.target.value)}
              >
                <option value="">Khách lẻ</option>
                {customers.map((customer) => (
                  <option value={customer.id} key={customer.id}>
                    {customer.name}
                    {customer.phone ? ` · ${customer.phone}` : ''}
                  </option>
                ))}
              </select>
            </label>

            <button
              className="sales-clear-cart"
              type="button"
              disabled={cartLines.length === 0}
              onClick={() => setCart({})}
            >
              <span aria-hidden="true">⌫</span> Xóa tất cả
            </button>
          </div>

          {cartLines.length === 0 ? (
            <div className="sales-empty sales-empty--cart">
              Tìm hoặc quét Product để thêm vào hóa đơn.
            </div>
          ) : (
            <div className="sales-cart-list">
              {cartLines.map((line) => {
                const product = line.product;
                if (!product) {
                  return (
                    <article
                      className="sales-cart-line sales-cart-line--invalid"
                      key={line.productId}
                    >
                      <span className="sales-product-thumb" aria-hidden="true">
                        ⚠️
                      </span>
                      <div className="sales-cart-line__identity">
                        <strong>Sản phẩm không còn tồn tại</strong>
                        <span>{line.productId}</span>
                      </div>
                      <button
                        className="sales-remove-line"
                        type="button"
                        onClick={() => removeLine(line.productId)}
                        aria-label="Xóa sản phẩm không còn tồn tại"
                      >
                        ×
                      </button>
                    </article>
                  );
                }

                const lineTotal = Math.round(
                  line.quantity * (Number(product.salePrice) || 0),
                );
                return (
                  <article
                    ref={(node) => {
                      if (node) cartLineRefs.current.set(product.id, node);
                      else cartLineRefs.current.delete(product.id);
                    }}
                    tabIndex={-1}
                    className={`sales-cart-line${product.active ? '' : ' sales-cart-line--invalid'}`}
                    key={product.id}
                  >
                    <ProductThumbnail
                      product={product}
                      className="sales-product-thumb sales-product-thumb--image"
                      eager
                    />
                    <div className="sales-cart-line__identity">
                      <strong>{product.name}</strong>
                      <span>
                        {product.sku}
                        {product.unit ? ` · ${product.unit}` : ''}
                      </span>
                    </div>
                    <button
                      className="sales-remove-line"
                      type="button"
                      onClick={() => removeLine(product.id)}
                      aria-label={`Xóa ${product.name} khỏi hóa đơn`}
                    >
                      ×
                    </button>
                    <div className="sales-cart-line__actions">
                      <div className="sales-qty-control">
                        <button
                          type="button"
                          aria-label={`Giảm số lượng ${product.name}`}
                          onClick={() =>
                            setLineQuantity(product, line.quantity - 1)
                          }
                        >
                          −
                        </button>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0.001"
                          step="0.001"
                          max={Number(product.stockQuantity) || undefined}
                          value={line.quantity}
                          aria-label={`Số lượng ${product.name}`}
                          onChange={(event) =>
                            setLineQuantity(
                              product,
                              event.currentTarget.valueAsNumber,
                            )
                          }
                        />
                        <button
                          type="button"
                          aria-label={`Tăng số lượng ${product.name}`}
                          onClick={() =>
                            setLineQuantity(product, line.quantity + 1)
                          }
                        >
                          +
                        </button>
                      </div>
                      <div className="sales-cart-line__price">
                        <small>
                          × {formatMoney(Number(product.salePrice) || 0)}
                        </small>
                        <strong>{formatMoney(lineTotal)}</strong>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          <div ref={quickAmountCardRef} className="sales-quick-amount-card">
            {cashExpenseMode ? (
              <div className="sales-field-heading">
                <span aria-hidden="true">↗</span>
                <div>
                  <strong>Nhập số tiền xuất</strong>
                  <small>Nhập theo nghìn đồng · 125 = 125.000đ</small>
                </div>
              </div>
            ) : hasProductIntent ? (
              <div className="sales-field-heading">
                <span aria-hidden="true">◉</span>
                <div>
                  <strong>Nhập nhanh giảm giá</strong>
                  <button
                    type="button"
                    className="sales-clear-product-order"
                    onClick={clearProductOrder}
                    aria-label="Xóa toàn bộ sản phẩm đã chọn"
                  >
                    Xóa đơn
                  </button>
                </div>
              </div>
            ) : null}
            <div className="sales-quick-amount-input-row">
              <input
                ref={quickAmountInputRef}
                type="text"
                inputMode={tabletPosLayout ? 'none' : 'numeric'}
                autoComplete="off"
                readOnly={tabletPosLayout}
                value={
                  cashExpenseMode
                    ? cashExpenseAmount
                    : discount > 0
                      ? String(discount)
                      : ''
                }
                disabled={amountInputDisabled}
                onFocus={(event) => {
                  if (tabletPosLayout) event.currentTarget.blur();
                }}
                onChange={(event) => {
                  if (tabletPosLayout) return;
                  if (cashExpenseMode) {
                    if (!cashExpenseInputLocked)
                      setCashExpenseAmount(
                        event.currentTarget.value
                          .replace(/\D/g, '')
                          .slice(0, 9),
                      );
                    return;
                  }
                  if (hasProductIntent) {
                    const digits = event.currentTarget.value
                      .replace(/\D/g, '')
                      .slice(0, 9);
                    const next = Number(digits || 0);
                    fastDiscountRef.current = next;
                    setDiscount(next);
                    return;
                  }
                }}
                placeholder={
                  cashExpenseMode
                    ? 'Ví dụ 125 = 125.000đ'
                    : 'Nhập giảm giá (VND)'
                }
                aria-label={
                  cashExpenseMode
                    ? 'Nhập số tiền xuất theo đơn vị nghìn đồng'
                    : 'Nhập nhanh giảm giá bằng VND'
                }
              />
              <span className="sales-quick-amount-preview">
                {cashExpenseMode
                  ? formatMoney(
                      cashExpenseStatus.pending?.amount ?? cashExpenseAmountVnd,
                    )
                  : formatMoney(discount)}
              </span>
            </div>
            <div
              className="sales-tablet-keypad"
              aria-label={
                cashExpenseMode
                  ? 'Bàn phím nhập số tiền xuất'
                  : hasProductIntent
                    ? 'Bàn phím nhập giảm giá trên tablet'
                    : 'Bàn phím nhập số tiền trên tablet'
              }
            >
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                <button
                  key={digit}
                  type="button"
                  disabled={amountInputDisabled}
                  onPointerDown={(event) =>
                    handleNumpadPointerDown(event, () =>
                      appendQuickAmountDigit(digit),
                    )
                  }
                  onClick={(event) => {
                    if (event.detail === 0) appendQuickAmountDigit(digit);
                  }}
                >
                  {digit}
                </button>
              ))}
              <button
                type="button"
                disabled={amountInputDisabled}
                onPointerDown={(event) =>
                  handleNumpadPointerDown(event, clearQuickAmount)
                }
                onClick={(event) => {
                  if (event.detail === 0) clearQuickAmount();
                }}
              >
                C
              </button>
              <button
                type="button"
                disabled={amountInputDisabled}
                onPointerDown={(event) =>
                  handleNumpadPointerDown(event, () =>
                    appendQuickAmountDigit('0'),
                  )
                }
                onClick={(event) => {
                  if (event.detail === 0) appendQuickAmountDigit('0');
                }}
              >
                0
              </button>
              <button
                type="button"
                disabled={amountInputDisabled}
                onPointerDown={(event) =>
                  handleNumpadPointerDown(event, removeQuickAmountDigit)
                }
                onClick={(event) => {
                  if (event.detail === 0) removeQuickAmountDigit();
                }}
                aria-label="Xóa một số"
              >
                ⌫
              </button>
            </div>
          </div>

          {!widePosLayout || cashExpenseMode || hasProductIntent ? (
            <label className="sales-note-field sales-note-field--invoice">
              <span className="sales-field-heading">
                <span aria-hidden="true">▧</span>
                <strong>
                  {cashExpenseMode
                    ? 'Ghi chú / lý do xuất tiền (không bắt buộc)'
                    : 'Ghi chú / địa chỉ khách (không bắt buộc)'}
                </strong>
              </span>
              <textarea
                rows={2}
                maxLength={200}
                value={shownNote}
                disabled={cashExpenseMode && cashExpenseInputLocked}
                onChange={(event) => changeShownNote(event.target.value)}
                placeholder={
                  cashExpenseMode
                    ? 'Nhập lý do xuất tiền…'
                    : 'Nhập ghi chú, địa chỉ giao hàng / địa chỉ khách...'
                }
              />
              <small>{shownNote.length}/200</small>
            </label>
          ) : null}

          <div className="sales-summary" hidden={cashExpenseMode}>
            <div>
              <span>Tổng tiền hàng</span>
              <strong>{formatMoney(subtotal)}</strong>
            </div>
            <div className="sales-discount-field">
              <VndMoneyInput
                label="Giảm giá đơn (VND)"
                ariaLabel="Giảm giá bằng số tiền VND"
                value={discount}
                readOnly={tabletPosLayout}
                onChange={(value) =>
                  setDiscount(Math.max(0, Math.round(Number(value) || 0)))
                }
                className="sales-discount-input"
                labelClassName="sales-discount-label"
              />
            </div>
            <div className="sales-summary__payable">
              <span>Khách cần trả</span>
              <strong>{formatMoney(payable)}</strong>
            </div>
          </div>

          <div
            ref={paymentGridRef}
            className="sales-payment-grid"
            aria-label="Thanh toán"
          >
            <button
              className={`sales-payment-button sales-payment-button--cash${!cashExpenseMode && paymentMethod === 'cash' ? ' is-selected' : ''}`}
              type="button"
              aria-disabled={
                submitting ||
                !online ||
                (cashExpenseMode
                  ? cashExpenseStatus.saving ||
                    (cashExpenseStatus.pending
                      ? cashExpenseStatus.pending.method !== 'cash'
                      : cashExpenseAmountVnd <= 0)
                  : !hasProductIntent ||
                    cartIssues.length > 0 ||
                    discount > subtotal)
              }
              aria-busy={
                cashExpenseMode
                  ? cashExpenseStatus.saving
                  : submitting && paymentMethod === 'cash'
              }
              onClick={() => void handleCheckout('cash')}
            >
              <PosActionIcon name="cash" />
              <span>
                <strong>Tiền mặt</strong>
                <small>
                  {cashExpenseMode
                    ? cashExpenseStatus.saving
                      ? 'Đang lưu…'
                      : cashExpenseStatus.pending
                        ? 'Thử lại khoản xuất'
                        : 'Xác nhận xuất tiền mặt'
                    : submitting && paymentMethod === 'cash'
                      ? 'Đang xử lý...'
                      : 'Thanh toán bằng tiền mặt'}
                </small>
              </span>
            </button>
            <button
              className={`sales-payment-button sales-payment-button--bank${!cashExpenseMode && paymentMethod === 'bank_transfer' ? ' is-selected' : ''}`}
              type="button"
              aria-disabled={
                submitting ||
                !online ||
                (cashExpenseMode
                  ? cashExpenseStatus.saving ||
                    (cashExpenseStatus.pending
                      ? cashExpenseStatus.pending.method !== 'bank_transfer'
                      : cashExpenseAmountVnd <= 0)
                  : !hasProductIntent ||
                    cartIssues.length > 0 ||
                    discount > subtotal)
              }
              aria-busy={
                cashExpenseMode
                  ? cashExpenseStatus.saving
                  : submitting && paymentMethod === 'bank_transfer'
              }
              onClick={() => void handleCheckout('bank_transfer')}
            >
              <PosActionIcon name="bankTransfer" />
              <span>
                <strong>Chuyển khoản</strong>
                <small>
                  {cashExpenseMode
                    ? cashExpenseStatus.saving
                      ? 'Đang lưu…'
                      : cashExpenseStatus.pending
                        ? 'Thử lại khoản xuất'
                        : 'Xác nhận xuất chuyển khoản'
                    : submitting && paymentMethod === 'bank_transfer'
                      ? 'Đang xử lý...'
                      : 'Thanh toán qua ngân hàng'}
                </small>
              </span>
            </button>
          </div>

          <div
            className={`sales-secondary-actions${cashExpenseAvailable ? ' sales-secondary-actions--drawer' : ''}`}
          >
            <button
              type="button"
              disabled={cashExpenseMode}
              onClick={handleSaveDraft}
            >
              <PosActionIcon name="draft" />
              <span>
                <strong>Lưu tạm</strong>
                <small>Lưu trên thiết bị này</small>
              </span>
            </button>
            {cashExpenseAvailable ? (
              <button
                className="sales-manual-drawer-button"
                type="button"
                disabled={
                  !cashExpenseAvailable ||
                  submitting ||
                  cashExpenseLocked ||
                  manualDrawerBusy
                }
                aria-busy={manualDrawerBusy}
                onClick={() => void handleManualDrawerOpen()}
              >
                <PosActionIcon name="cash" />
                <span>
                  <strong>{manualDrawerBusy ? 'Đang gửi…' : 'Mở két'}</strong>
                  <small>Mở két tiền</small>
                </span>
              </button>
            ) : null}
          </div>
        </section>

        <section
          className="sales-recent-card"
          aria-labelledby="sales-recent-heading"
        >
          <div className="sales-recent-header">
            <div>
              <span className="sales-recent-icon" aria-hidden="true">
                ◷
              </span>
              <h2
                ref={recentHeadingRef}
                id="sales-recent-heading"
                tabIndex={-1}
              >
                Lịch sử giao dịch <small>(4 gần nhất)</small>
              </h2>
            </div>
            <button type="button" onClick={openHistory}>
              Xem toàn bộ
            </button>
          </div>

          {recentError ? (
            <div className="sales-error" role="alert">
              <span>{recentError}</span>
            </div>
          ) : null}
          {!recentError && recentSales.length === 0 ? (
            <div className="sales-empty">Chưa có giao dịch bán hàng.</div>
          ) : (
            <div className="sales-recent-list">
              {recentSales.map((sale) => {
                const summary = summarizeRecentSale(sale);
                return (
                  <article className="sales-recent-row" key={sale.id}>
                    <time dateTime={new Date(sale.createdAt).toISOString()}>
                      {formatTime(sale.createdAt)}
                    </time>
                    <div className="sales-recent-row__main">
                      <strong>{summary.label}</strong>
                      <small>{summary.note || sale.code}</small>
                    </div>
                    <span className="sales-recent-row__qty">
                      {summary.quantity == null
                        ? '—'
                        : `×${formatQuantity(summary.quantity)}`}
                    </span>
                    <strong className="sales-recent-row__amount">
                      {formatMoney(sale.total)}
                    </strong>
                    <span
                      className={`sales-status sales-status--${sale.status}`}
                    >
                      {sale.status === 'completed'
                        ? 'Hoàn tất'
                        : sale.status === 'cancelled'
                          ? 'Đã hủy'
                          : 'Đã hoàn'}
                    </span>
                  </article>
                );
              })}
            </div>
          )}
          <p className="sales-recent-note">4 giao dịch bán hàng gần nhất.</p>
        </section>
      </div>
    </>
  );
}
