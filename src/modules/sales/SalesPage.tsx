import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useAuth } from '../../auth/AuthContext';
import { hasModulePermission } from '../../auth/permissions';
import PosCashExpense, { type CashExpenseHandle, type CashExpenseStatus } from './PosCashExpense';
import { openCashDrawerAfterTransaction } from './cashDrawerClient';
import VndMoneyInput from '../../shared/numeric/VndMoneyInput';
import { playScanSuccessFeedback, primeScanSuccessFeedback } from '../../shared/audio/scanSuccessFeedback';
import { searchProducts } from '../../shared/search/productSearch';
import type { Category, Customer, PaymentMethod, Product, Sale } from '../../types/models';
import ProductThumbnail from '../products/ProductThumbnail';
import { subscribeProducts } from '../products/productService';
import { subscribeCategories } from '../products/categoryService';
import BarcodeScanner from '../qr/BarcodeScanner';
import { findProductByScannedCode } from '../qr/productLookup';
import ReceiptPrintControl from '../printing/ReceiptPrintControl';
import SaleHistoryPage from './SaleHistoryPage';
import ProductNameMarquee from './ProductNameMarquee';
import PosActionIcon from './PosActionIcon';
import QuickServiceIcon from './QuickServiceIcon';
import { requestDeepSeekQuickAsk } from './deepSeekQuickAskClient';
import {
  requestMarketPriceComparison,
  type MarketPriceComparison,
} from './marketPriceSearchClient';
import { parseSalesChatQuery } from './salesChatParser';
import { answerSalesChatProduct } from './salesChatSearch';
import { normalizeSalesAiLearningQuery } from './salesAiLearningSearch';
import {
  loadSalesAiLearningEvidence,
  recordSalesAiLearningSignal,
  recordSalesAiQueryObservation,
  subscribeApprovedSalesAiComponents,
  type SalesAiInputSource,
  type SalesAiLearningComponentMapping,
} from './salesAiLearningService';
import { runHybridSalesChat, type HybridSalesChatResult } from './salesQuickAskHybrid';
import {
  getSalesVoiceErrorMessage,
  startSalesVoiceInput,
  type SalesVoiceSession,
} from './salesVoiceInput';
import {
  FIXED_SERVICE_TILES,
  getRecentSales,
  parseQuickServiceAmount,
  summarizeRecentSale,
  type QuickServiceId,
} from './salesPosUi';
import {
  cancelQuickServiceSale,
  createQuickServiceSale,
  createSale,
  createSaleId,
  subscribeCustomers,
  subscribeSales,
} from './salesService';
import './sales.css';
import './salesPosOverrides.css';
import './salesUnifiedSearch.css';
import './posCashExpense.css';

type CartState = Record<string, number>;
type PosPaymentMethod = Extract<PaymentMethod, 'cash' | 'bank_transfer'>;

type QuickAskLearningCartContext = {
  query: string;
  normalizedSignature: string;
  addedAt: number;
  quantityBefore: number;
  sessionId: string;
  inputSource: SalesAiInputSource;
  components: Array<{ source: string; target: string; kind: 'spoken-model' | 'phonetic' | 'learned'; confidence: number }>;
  candidateSnapshots: Array<{ productId: string; rank: number; score?: number; evidenceTier?: string }>;
  candidateRank?: number;
};

type QuickAskSelectionContext = {
  query: string;
  normalizedSignature: string;
  startedAt: number;
  inputSource: SalesAiInputSource;
  result: HybridSalesChatResult;
};

type ManualCorrectionContext = {
  query: string;
  normalizedSignature: string;
  suggestedProductId?: string;
  startedAt: number;
  inputSource: SalesAiInputSource;
  result: HybridSalesChatResult;
};

const QUICK_ASK_REMOVE_NEGATIVE_WINDOW_MS = 2 * 60 * 1000;

type SavedDraft = {
  cart?: CartState;
  discount?: number;
  paymentMethod?: PaymentMethod;
  customerId?: string;
  note?: string;
  pendingSaleId?: string;
  pendingQuickSaleId?: string;
  selectedServiceId?: QuickServiceId;
  quickAmountInput?: string;
};

const DRAFT_STORAGE_KEY = 'quan-ly-ban-hang.sales-pos-draft.v1';

function formatMoney(value: number) {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(value);
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' }).format(value);
}

function roundQuantity(value: number) {
  return Math.round(value * 1000) / 1000;
}

function writeSavedDraft(draft: SavedDraft) {
  localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
}

function readSavedDraft(): Required<Pick<
  SavedDraft,
  'cart' | 'discount' | 'paymentMethod' | 'customerId' | 'note' | 'pendingSaleId' | 'pendingQuickSaleId' | 'quickAmountInput'
>> & { selectedServiceId: QuickServiceId | null } {
  const fallback = {
    cart: {},
    discount: 0,
    paymentMethod: 'cash' as PaymentMethod,
    customerId: '',
    note: '',
    pendingSaleId: '',
    pendingQuickSaleId: '',
    selectedServiceId: null,
    quickAmountInput: '',
  };

  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as SavedDraft;
    const cart = parsed.cart && typeof parsed.cart === 'object'
      ? Object.fromEntries(
          Object.entries(parsed.cart)
            .map(([productId, quantity]) => [productId, roundQuantity(Number(quantity))] as const)
            .filter(([productId, quantity]) => Boolean(productId) && Number.isFinite(quantity) && quantity > 0),
        )
      : {};
    const selectedServiceId = FIXED_SERVICE_TILES.some((service) => service.id === parsed.selectedServiceId)
      ? parsed.selectedServiceId ?? null
      : null;

    return {
      cart,
      discount: Number.isFinite(Number(parsed.discount)) && Number(parsed.discount) >= 0
        ? Math.round(Number(parsed.discount))
        : 0,
      paymentMethod: parsed.paymentMethod === 'bank_transfer' ? 'bank_transfer' : 'cash',
      customerId: typeof parsed.customerId === 'string' ? parsed.customerId : '',
      note: typeof parsed.note === 'string' ? parsed.note : '',
      pendingSaleId: typeof parsed.pendingSaleId === 'string' ? parsed.pendingSaleId : '',
      pendingQuickSaleId: typeof parsed.pendingQuickSaleId === 'string' ? parsed.pendingQuickSaleId : '',
      selectedServiceId,
      quickAmountInput: typeof parsed.quickAmountInput === 'string' ? parsed.quickAmountInput : '',
    };
  } catch {
    return fallback;
  }
}

export default function SalesPage() {
  const { appUser, firebaseUser } = useAuth();
  const initialDraft = useMemo(() => readSavedDraft(), []);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
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
  const voiceSessionRef = useRef<SalesVoiceSession | null>(null);
  const voiceProcessTimerRef = useRef<number | null>(null);
  const quickAskRequestIdRef = useRef(0);
  const quickAskSessionIdRef = useRef(
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `sales-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const quickAskSelectionRef = useRef<QuickAskSelectionContext | null>(null);
  const quickAskLearningCartRef = useRef(new Map<string, QuickAskLearningCartContext>());
  const quickCheckoutScrollTimerRef = useRef<number | null>(null);
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
  const [chatQuery, setChatQuery] = useState('');
  const [chatResult, setChatResult] = useState<HybridSalesChatResult | null>(null);
  const [marketPriceComparison, setMarketPriceComparison] = useState<MarketPriceComparison | null>(null);
  const [marketPriceError, setMarketPriceError] = useState('');
  const [chatProcessing, setChatProcessing] = useState(false);
  const [approvedPhoneticMappings, setApprovedPhoneticMappings] = useState<SalesAiLearningComponentMapping[]>([]);
  const [manualCorrectionContext, setManualCorrectionContext] = useState<ManualCorrectionContext | null>(null);
  const [manualCorrectionSaving, setManualCorrectionSaving] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState('');
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
  const [cashExpenseStatus, setCashExpenseStatus] = useState<CashExpenseStatus>({ saving: false, pending: null });
  const resetCashExpenseDraft = useCallback(() => {
    setCashExpenseAmount('');
    setCashExpenseNote('');
  }, []);
  const handleCashExpenseNotice = useCallback((notice: string | null, error: string | null) => {
    setLastCompletedSale(null);
    setMessage(notice);
    setCheckoutError(error);
    if (notice) scheduleSaleNoticeExpiry(`expense-${Date.now()}`);
  }, []);
  const [pendingSaleId, setPendingSaleId] = useState(initialDraft.pendingSaleId);
  const [pendingQuickSaleId, setPendingQuickSaleId] = useState(initialDraft.pendingQuickSaleId);
  const [selectedServiceId, setSelectedServiceId] = useState<QuickServiceId | null>(initialDraft.selectedServiceId);
  const [quickAmountInput, setQuickAmountInput] = useState(initialDraft.quickAmountInput);
  const fastDiscountRef = useRef(initialDraft.discount);
  const fastQuickAmountRef = useRef(initialDraft.quickAmountInput);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [manualDrawerBusy, setManualDrawerBusy] = useState(false);
  const [busyQuickCancelId, setBusyQuickCancelId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [lastCompletedSale, setLastCompletedSale] = useState<Sale | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [draftMessage, setDraftMessage] = useState('');
  const [online, setOnline] = useState(() => navigator.onLine);
  const [topbarNotificationHost, setTopbarNotificationHost] = useState<HTMLElement | null>(null);
  const [tabletPosLayout, setTabletPosLayout] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 761px) and (max-width: 1180px)').matches,
  );
  const [widePosLayout, setWidePosLayout] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 761px)').matches,
  );
  const cashExpenseAvailable = Boolean(appUser?.active && hasModulePermission(appUser, 'expenses'));
  useEffect(() => {
    resetCashExpenseDraft();
  }, [appUser?.uid, resetCashExpenseDraft]);
  const [searchAiHost, setSearchAiHost] = useState<HTMLDivElement | null>(null);
  const setSearchAiHostRef = useCallback((node: HTMLDivElement | null) => {
    setSearchAiHost(node);
  }, []);

  useEffect(() => {
    setTopbarNotificationHost(document.getElementById('topbar-notification-slot'));
  }, []);

  useEffect(() => {
    fastDiscountRef.current = discount;
  }, [discount]);

  useEffect(() => {
    fastQuickAmountRef.current = quickAmountInput;
  }, [quickAmountInput]);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 761px) and (max-width: 1180px)');
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
      setProductsError(cause instanceof Error ? cause.message : 'Không thể tải sản phẩm.');
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
    try {
      return subscribeApprovedSalesAiComponents(
        setApprovedPhoneticMappings,
        () => setApprovedPhoneticMappings([]),
      );
    } catch {
      setApprovedPhoneticMappings([]);
      return undefined;
    }
  }, [dataRetryNonce]);

  useEffect(() => {
    setCustomerError(null);
    try {
      return subscribeCustomers(setCustomers, (cause) => setCustomerError(cause.message));
    } catch (cause) {
      setCustomerError(cause instanceof Error ? cause.message : 'Không thể tải khách hàng.');
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
      setRecentError(cause instanceof Error ? cause.message : 'Không thể tải giao dịch gần đây.');
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

  useEffect(() => () => {
    voiceSessionRef.current?.cancel();
    voiceSessionRef.current = null;
    if (voiceProcessTimerRef.current !== null) window.clearTimeout(voiceProcessTimerRef.current);
    if (quickCheckoutScrollTimerRef.current !== null) window.clearTimeout(quickCheckoutScrollTimerRef.current);
    if (saleNoticeTimerRef.current !== null) window.clearTimeout(saleNoticeTimerRef.current);
    if (draftSaveTimerRef.current !== null) {
      window.clearTimeout(draftSaveTimerRef.current);
      writeSavedDraft(latestDraftRef.current);
      draftSaveTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const nextDraft: SavedDraft = {
      cart,
      discount,
      paymentMethod,
      customerId,
      note,
      pendingSaleId,
      pendingQuickSaleId,
      ...(selectedServiceId ? { selectedServiceId } : {}),
      quickAmountInput,
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
  }, [cart, discount, paymentMethod, customerId, note, pendingSaleId, pendingQuickSaleId, selectedServiceId, quickAmountInput]);

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

  const activeProducts = useMemo(() => products.filter((product) => product.active === true), [products]);
  const searchResults = useMemo(
    () => search.trim() ? searchProducts(activeProducts, search, { limit: 8, categories }) : [],
    [activeProducts, search, categories],
  );
  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const resolvedChatProduct = chatResult?.resolvedProductId ? productById.get(chatResult.resolvedProductId) : undefined;
  const cartLines = useMemo(
    () => Object.entries(cart).map(([productId, quantity]) => ({ productId, quantity, product: productById.get(productId) })),
    [cart, productById],
  );
  const tabletCartLines = useMemo(
    () => cartLines.filter((line) => Boolean(line.product)),
    [cartLines],
  );
  const tabletCartPages = useMemo(
    () => Array.from(
      { length: Math.ceil(tabletCartLines.length / 6) },
      (_, pageIndex) => tabletCartLines.slice(pageIndex * 6, pageIndex * 6 + 6),
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
    () => cartLines.reduce((sum, line) => {
      if (!line.product || !Number.isFinite(Number(line.product.salePrice))) return sum;
      return sum + Math.round(line.quantity * Number(line.product.salePrice));
    }, 0),
    [cartLines],
  );
  const selectedService = FIXED_SERVICE_TILES.find((service) => service.id === selectedServiceId) ?? null;
  const quickAmount = useMemo(() => parseQuickServiceAmount(quickAmountInput), [quickAmountInput]);
  const cashExpenseMode = cashExpenseAvailable && cashExpenseActive;
  const parsedCashExpenseAmount = parseQuickServiceAmount(cashExpenseAmount);
  const cashExpenseAmountVnd = parsedCashExpenseAmount.state === 'valid' ? parsedCashExpenseAmount.amount : 0;
  const cashExpenseInputLocked = cashExpenseLocked || cashExpenseStatus.saving || Boolean(cashExpenseStatus.pending);
  const shownNote = cashExpenseMode ? cashExpenseNote : note;
  const changeShownNote = cashExpenseMode ? setCashExpenseNote : setNote;
  const hasProductIntent = cartLines.length > 0;
  const amountInputDisabled = cashExpenseMode
    ? cashExpenseInputLocked || submitting || !online
    : hasProductIntent ? Boolean(pendingSaleId) : (!selectedService || Boolean(pendingQuickSaleId));
  const hasQuickIntent = Boolean(selectedServiceId && quickAmount.state === 'valid');
  const mixedIntent = hasProductIntent && hasQuickIntent;
  const checkoutSubtotal = !hasProductIntent && quickAmount.state === 'valid' ? quickAmount.amount : subtotal;
  const payable = hasProductIntent ? Math.max(0, subtotal - discount) : checkoutSubtotal;

  const cartIssues = useMemo(() => cartLines.flatMap((line) => {
    const product = line.product;
    if (!product) return [`Sản phẩm ${line.productId} không còn tồn tại.`];
    if (product.active !== true) return [`${product.sku} - ${product.name} đã ngừng hoạt động.`];
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) return [`Số lượng ${product.name} không hợp lệ.`];
    if (line.quantity > Number(product.stockQuantity || 0)) {
      return [`${product.sku} - ${product.name}: giỏ ${formatQuantity(line.quantity)}, tồn hiện tại ${formatQuantity(Number(product.stockQuantity || 0))}.`];
    }
    if (!Number.isFinite(Number(product.salePrice)) || Number(product.salePrice) < 0) {
      return [`Giá bán ${product.name} không hợp lệ.`];
    }
    return [];
  }), [cartLines]);

  const scrollProductIntoCheckout = useCallback((productId: string) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const target = cartLineRefs.current.get(productId) ?? invoiceCardRef.current;
        if (!target) return;
        target.focus({ preventScroll: true });
        target.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
      });
    });
  }, []);

  const scrollQuickCheckoutControlsIntoView = useCallback(() => {
    const amountCard = quickAmountCardRef.current;
    const paymentGrid = paymentGridRef.current;
    if (!amountCard || !paymentGrid) return;

    const amountRect = amountCard.getBoundingClientRect();
    const paymentRect = paymentGrid.getBoundingClientRect();
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const padding = 12;
    const amountTop = window.scrollY + amountRect.top - padding;
    const paymentBottomTop = window.scrollY + paymentRect.bottom - viewportHeight + padding;

    window.scrollTo({
      top: Math.max(0, amountTop, paymentBottomTop),
      behavior: 'smooth',
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
        setCheckoutError(`Không thể thêm vượt tồn hiện tại (${formatQuantity(stock)} ${product.unit || ''}).`);
        return current;
      }
      return { ...current, [product.id]: nextQuantity };
    });
  }, []);

  const addProductQuantity = useCallback((product: Product, quantity: number) => {
    setCheckoutError(null);
    setMessage(null);
    setDraftMessage('');
    if (!product.active) {
      setCheckoutError(`${product.sku} - ${product.name} đã ngừng hoạt động.`);
      return false;
    }
    const stock = Number(product.stockQuantity) || 0;
    const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? roundQuantity(quantity) : 1;
    const nextQuantity = roundQuantity((cart[product.id] ?? 0) + safeQuantity);
    if (stock <= 0 || nextQuantity > stock) {
      setCheckoutError(
        stock <= 0
          ? `${product.sku} - ${product.name} đã hết hàng.`
          : `Không thể thêm ${formatQuantity(safeQuantity)} ${product.unit || ''}; tồn hiện tại là ${formatQuantity(stock)}.`,
      );
      return false;
    }
    setCart((current) => ({ ...current, [product.id]: roundQuantity((current[product.id] ?? 0) + safeQuantity) }));
    return true;
  }, [cart]);

  const recordQuickAskAdd = useCallback((
    product: Product,
    result: HybridSalesChatResult,
    candidateRank?: number,
    quantityBefore = 0,
  ) => {
    if (!appUser?.uid || !result.query.trim()) return;
    const selection = quickAskSelectionRef.current?.query === result.query
      ? quickAskSelectionRef.current
      : null;
    const telemetry = result.telemetry;
    const sessionId = quickAskSessionIdRef.current;
    const inputSource = selection?.inputSource ?? 'keyboard';
    const normalizedSignature = telemetry?.normalizedSignature || telemetry?.normalizedQuery || result.query;
    const components = (telemetry?.explanations ?? []).map((item) => ({
      source: item.source,
      target: item.target,
      kind: item.kind,
      confidence: item.confidence,
    }));
    const candidateSnapshots = telemetry?.candidates ?? [];
    const elapsed = selection ? Date.now() - selection.startedAt : undefined;

    quickAskLearningCartRef.current.set(product.id, {
      query: result.query,
      normalizedSignature,
      addedAt: Date.now(),
      quantityBefore: roundQuantity(Math.max(0, quantityBefore)),
      sessionId,
      inputSource,
      components,
      candidateSnapshots,
      ...(Number.isInteger(candidateRank) ? { candidateRank } : {}),
    });

    void recordSalesAiLearningSignal({
      query: result.query,
      normalizedSignature,
      product,
      event: 'ADD_TO_CART',
      actorUid: appUser.uid,
      sessionId,
      inputSource,
      candidateRank,
      components,
      candidates: candidateSnapshots,
      timeToSelectionMs: elapsed,
    }).catch(() => {
      // Learning is best-effort and must never block POS cart operations.
    });
  }, [appUser?.uid]);

  const recordQuickAskSelection = useCallback((
    product: Product,
    result: HybridSalesChatResult,
    candidateRank?: number,
  ) => {
    if (!appUser?.uid) return;
    const selection = quickAskSelectionRef.current?.query === result.query
      ? quickAskSelectionRef.current
      : null;
    const telemetry = result.telemetry;
    void recordSalesAiLearningSignal({
      query: result.query,
      normalizedSignature: telemetry?.normalizedSignature || telemetry?.normalizedQuery || result.query,
      product,
      event: 'PRODUCT_SELECTED',
      actorUid: appUser.uid,
      sessionId: quickAskSessionIdRef.current,
      inputSource: selection?.inputSource ?? 'keyboard',
      candidateRank,
      components: telemetry?.explanations ?? [],
      candidates: telemetry?.candidates ?? [],
      timeToSelectionMs: selection ? Date.now() - selection.startedAt : undefined,
    }).catch(() => {
      // Selection feedback must never block the sales flow.
    });
  }, [appUser?.uid]);

  const recordQuickAskRemovalIfRecent = useCallback((productId: string, nextQuantity = 0) => {
    const context = quickAskLearningCartRef.current.get(productId);
    if (!context) return;
    if (roundQuantity(Math.max(0, nextQuantity)) > context.quantityBefore) return;
    quickAskLearningCartRef.current.delete(productId);
    if (Date.now() - context.addedAt > QUICK_ASK_REMOVE_NEGATIVE_WINDOW_MS) return;

    const product = productById.get(productId);
    if (!product || !appUser?.uid) return;
    void recordSalesAiLearningSignal({
      query: context.query,
      normalizedSignature: context.normalizedSignature,
      product,
      event: 'REMOVE_FROM_CART_SHORTLY_AFTER_ADD',
      actorUid: appUser.uid,
      sessionId: context.sessionId,
      inputSource: context.inputSource,
      candidateRank: context.candidateRank,
      components: context.components,
      candidates: context.candidateSnapshots,
    }).catch(() => {
      // Remove-soon is only a bounded negative and never blocks cart removal.
    });
  }, [appUser?.uid, productById]);

  function writeQuickAmountVisual(value: string) {
    const input = quickAmountInputRef.current;
    if (input && input.value !== value) input.value = value;
  }

  function appendQuickAmountDigit(digit: string) {
    if (cashExpenseMode) {
      if (cashExpenseInputLocked || submitting || !online) return;
      setCashExpenseAmount((current) => (current.replace(/\D/g, '') + digit).slice(0, 9));
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

    if (!selectedService || pendingQuickSaleId) return;
    const digits = fastQuickAmountRef.current.replace(/\D/g, '');
    if (digit === '00' && digits.length === 0) return;
    const next = (digits + digit).slice(0, 9);
    fastQuickAmountRef.current = next;
    writeQuickAmountVisual(next);
    setQuickAmountInput(next);
    setCheckoutError(null);
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
      const digits = String(Math.max(0, Math.round(fastDiscountRef.current))).replace(/\D/g, '');
      const next = Number(digits.slice(0, -1) || 0);
      fastDiscountRef.current = next;
      writeQuickAmountVisual(next > 0 ? String(next) : '');
      setDiscount(next);
      setCheckoutError(null);
      return;
    }

    if (!selectedService || pendingQuickSaleId) return;
    const next = fastQuickAmountRef.current.replace(/\D/g, '').slice(0, -1);
    fastQuickAmountRef.current = next;
    writeQuickAmountVisual(next);
    setQuickAmountInput(next);
    setCheckoutError(null);
  }

  function clearQuickAmount() {
    if (cashExpenseMode) {
      if (cashExpenseInputLocked || submitting || !online) return;
      setCashExpenseAmount((current) => '');
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

    if (!selectedService || pendingQuickSaleId) return;
    fastQuickAmountRef.current = '';
    writeQuickAmountVisual('');
    setQuickAmountInput('');
    setCheckoutError(null);
  }

  function handleNumpadPointerDown(event: PointerEvent<HTMLButtonElement>, action: () => void) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    action();
  }

  function handleQuickServiceSelect(serviceId: QuickServiceId) {
    if (cashExpenseAvailable && cashExpenseLocked) return;
    setCashExpenseActive(false);
    if (pendingQuickSaleId) {
      setCheckoutError('Đang giữ Sale ID của lần lưu dịch vụ chưa xác nhận. Hãy thử lại đúng nội dung cũ trước khi đổi loại dịch vụ.');
      return;
    }

    flushSync(() => {
      setSelectedServiceId(serviceId);
      setQuickAmountInput('');
      setCheckoutError(null);
    });
    if (!window.matchMedia('(min-width: 761px) and (max-width: 1180px)').matches) {
      quickAmountInputRef.current?.focus({ preventScroll: true });
    }
    if (quickCheckoutScrollTimerRef.current !== null) window.clearTimeout(quickCheckoutScrollTimerRef.current);
    quickCheckoutScrollTimerRef.current = window.setTimeout(() => {
      quickCheckoutScrollTimerRef.current = null;
      scrollQuickCheckoutControlsIntoView();
    }, 260);
  }

  function setLineQuantity(product: Product, value: number) {
    setCheckoutError(null);
    setMessage(null);
    setDraftMessage('');
    const quantity = roundQuantity(value);
    if (!Number.isFinite(quantity)) return;
    recordQuickAskRemovalIfRecent(product.id, Math.max(0, quantity));
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
      setCheckoutError(`Không thể bán ${formatQuantity(quantity)} ${product.unit || ''}; tồn hiển thị hiện tại là ${formatQuantity(stock)}.`);
      return;
    }
    setCart((current) => ({ ...current, [product.id]: quantity }));
  }

  function removeLine(productId: string) {
    recordQuickAskRemovalIfRecent(productId);
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

    const exactCode = searchResults.find((result) => (
      result.kind === 'exact-qr' || result.kind === 'exact-barcode' || result.kind === 'exact-sku'
    ));
    const singleDeterministic = searchResults.length === 1 && !searchResults[0].kind.startsWith('fuzzy-')
      ? searchResults[0]
      : undefined;
    const targetResult = exactCode ?? singleDeterministic;

    if (manualCorrectionContext) {
      event.preventDefault();
      if (!targetResult) {
        setCheckoutError('Chưa có một sản phẩm đủ rõ để xác nhận sửa kết quả. Hãy chọn trong danh sách.');
        return;
      }
      void chooseManualCorrectionProduct(targetResult.product);
      return;
    }

    const parsed = parseSalesChatQuery(query);
    if (parsed.intent !== 'find' || !targetResult) return;

    event.preventDefault();
    const target = targetResult.product;
    addProduct(target);
    setSearch('');
    setChatQuery('');
    searchInputRef.current?.blur();
    scrollProductIntoCheckout(target.id);
  }

  function marketFailureMessage(reason: string) {
    if (reason === 'unconfigured' || reason === 'search-unavailable') {
      return 'Tìm giá Internet chưa được cấu hình hoặc dịch vụ tìm kiếm đang bận.';
    }
    if (reason === 'unauthorized') return 'Phiên đăng nhập không đủ quyền để tìm giá Internet.';
    if (reason === 'payment-required') return 'Dịch vụ AI hiện không đủ số dư để phân tích giá.';
    if (reason === 'rate-limited') return 'Đã đạt giới hạn tìm kiếm tạm thời. Hãy thử lại sau.';
    if (reason === 'timeout') return 'Tìm giá Internet quá thời gian chờ.';
    return 'Chưa thể lấy giá Internet lúc này.';
  }

  async function runMarketComparison(
    query: string,
    product: Product,
    baseResult: HybridSalesChatResult,
    requestId: number,
  ) {
    setMarketPriceComparison(null);
    setMarketPriceError('');
    setChatResult({
      ...baseResult,
      candidates: [],
      resolvedProductId: product.id,
      message: `Đang tìm giá ${product.name} trên Internet theo đúng yêu cầu của bạn…`,
    });

    const market = await requestMarketPriceComparison(
      query,
      {
        name: product.name,
        salePrice: Math.round(Number(product.salePrice) || 0),
      },
      {
        getIdToken: async () => firebaseUser ? firebaseUser.getIdToken() : null,
      },
    );
    if (quickAskRequestIdRef.current !== requestId) return;

    if (!market.ok) {
      const errorMessage = marketFailureMessage(market.reason);
      setMarketPriceError(errorMessage);
      setChatResult({
        ...baseResult,
        candidates: [],
        resolvedProductId: product.id,
        message: errorMessage,
      });
      return;
    }

    const comparison = market.comparison;
    setMarketPriceComparison(comparison);

    if (comparison.sampleCount === 0 || comparison.marketMedian === null) {
      setChatResult({
        ...baseResult,
        candidates: [],
        resolvedProductId: product.id,
        message: `Đã tìm trên Internet cho ${product.name}, nhưng chưa có mức giá đủ rõ và đủ tương đồng để so sánh an toàn.`,
      });
      return;
    }

    const deltaText = comparison.deltaAmount === null || comparison.deltaPercent === null
      ? ''
      : comparison.deltaAmount > 0
        ? ` Giá cửa hàng cao hơn trung vị ${formatMoney(Math.abs(comparison.deltaAmount))} (${Math.abs(comparison.deltaPercent)}%).`
        : comparison.deltaAmount < 0
          ? ` Giá cửa hàng thấp hơn trung vị ${formatMoney(Math.abs(comparison.deltaAmount))} (${Math.abs(comparison.deltaPercent)}%).`
          : ' Giá cửa hàng bằng mức trung vị tham khảo.';

    setChatResult({
      ...baseResult,
      candidates: [],
      resolvedProductId: product.id,
      message: `Giá cửa hàng: ${formatMoney(comparison.localPrice)}. Giá tham khảo Internet: ${formatMoney(comparison.marketMin ?? comparison.marketMedian)} – ${formatMoney(comparison.marketMax ?? comparison.marketMedian)}; trung vị ${formatMoney(comparison.marketMedian)} từ ${comparison.sampleCount} nguồn.${deltaText}`,
    });
  }

  async function processQuickAsk(query: string, fromVoice = false) {
    const requestId = quickAskRequestIdRef.current + 1;
    const startedAt = Date.now();
    const inputSource: SalesAiInputSource = fromVoice ? 'voice' : 'keyboard';
    quickAskRequestIdRef.current = requestId;
    setChatProcessing(true);
    setMarketPriceComparison(null);
    setMarketPriceError('');
    setManualCorrectionContext(null);
    try {
      const contextProduct = chatResult?.resolvedProductId
        ? productById.get(chatResult.resolvedProductId)
        : undefined;
      const result = await runHybridSalesChat(products, query, categories, {
        aiSource: 'deepseek',
        contextProduct,
        getLearningEvidence: loadSalesAiLearningEvidence,
        approvedMappings: approvedPhoneticMappings.map(({ source, target }) => ({ source, target })),
        interpret: (value) => requestDeepSeekQuickAsk(value, {
          getIdToken: async () => firebaseUser ? firebaseUser.getIdToken() : null,
        }),
      });
      if (quickAskRequestIdRef.current !== requestId) return;

      quickAskSelectionRef.current = {
        query: result.query,
        normalizedSignature: result.telemetry?.normalizedSignature || result.query,
        startedAt,
        inputSource,
        result,
      };
      setChatResult(result);
      if (fromVoice) setVoiceMessage(`Bạn: “${query}”`);

      if (appUser?.uid && result.telemetry) {
        void recordSalesAiQueryObservation({
          originalQuery: result.query,
          normalizedSignature: result.telemetry.normalizedSignature,
          normalizedQuery: result.telemetry.normalizedQuery,
          phoneticVariants: result.telemetry.phoneticVariants,
          normalizedCandidates: result.telemetry.normalizedCandidates,
          candidates: result.telemetry.candidates,
          inputSource,
          actorUid: appUser.uid,
          sessionId: quickAskSessionIdRef.current,
          localPhoneticResolved: result.telemetry.localPhoneticResolved,
          learnedMappingHit: result.telemetry.learnedMappingHit,
          deepSeekCalled: result.telemetry.deepSeekCalled,
          ambiguous: result.telemetry.ambiguous,
          timeToSelectionMs: result.resolvedProductId ? Date.now() - startedAt : undefined,
        }).catch(() => {
          // Metrics/learning telemetry is best-effort and never blocks Quick Ask.
        });
      }

      if (result.requestedMarketCompare && result.resolvedProductId) {
        const product = productById.get(result.resolvedProductId);
        if (product) await runMarketComparison(query, product, result, requestId);
      }
    } finally {
      if (quickAskRequestIdRef.current === requestId) setChatProcessing(false);
    }
  }

  function startManualCorrection() {
    if (!chatResult) return;
    const selection = quickAskSelectionRef.current?.query === chatResult.query
      ? quickAskSelectionRef.current
      : null;
    setManualCorrectionContext({
      query: chatResult.query,
      normalizedSignature: normalizeSalesAiLearningQuery(chatResult.query) || chatResult.query,
      suggestedProductId: chatResult.telemetry?.candidates[0]?.productId
        ?? chatResult.resolvedProductId,
      startedAt: selection?.startedAt ?? Date.now(),
      inputSource: selection?.inputSource ?? 'keyboard',
      result: chatResult,
    });
    setSearch('');
    setCheckoutError(null);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function cancelManualCorrection() {
    setManualCorrectionContext(null);
  }

  async function chooseManualCorrectionProduct(product: Product) {
    if (!manualCorrectionContext || !appUser?.uid || manualCorrectionSaving) return;

    const context = manualCorrectionContext;
    const telemetry = context.result.telemetry;
    const elapsed = Math.max(0, Date.now() - context.startedAt);
    setManualCorrectionSaving(true);
    setCheckoutError(null);

    try {
      await recordSalesAiLearningSignal({
        query: context.query,
        normalizedSignature: context.normalizedSignature,
        product,
        event: 'CORRECTION_WIN',
        actorUid: appUser.uid,
        sessionId: quickAskSessionIdRef.current,
        inputSource: context.inputSource,
        components: telemetry?.explanations ?? [],
        candidates: telemetry?.candidates ?? [],
        timeToSelectionMs: elapsed,
      });

      const suggested = context.suggestedProductId
        ? productById.get(context.suggestedProductId)
        : undefined;
      if (suggested && suggested.id !== product.id) {
        void recordSalesAiLearningSignal({
          query: context.query,
          normalizedSignature: context.normalizedSignature,
          product: suggested,
          event: 'CORRECTION_LOSS',
          actorUid: appUser.uid,
          sessionId: quickAskSessionIdRef.current,
          inputSource: context.inputSource,
          components: telemetry?.explanations ?? [],
          candidates: telemetry?.candidates ?? [],
          timeToSelectionMs: elapsed,
        }).catch(() => {
          // The confirmed correction was saved; optional negative evidence stays best-effort.
        });
      }

      void recordSalesAiQueryObservation({
        originalQuery: context.query,
        normalizedSignature: context.normalizedSignature,
        normalizedQuery: telemetry?.normalizedQuery || context.query,
        phoneticVariants: telemetry?.phoneticVariants ?? [],
        normalizedCandidates: telemetry?.normalizedCandidates ?? [],
        candidates: telemetry?.candidates ?? [],
        inputSource: context.inputSource,
        actorUid: appUser.uid,
        sessionId: quickAskSessionIdRef.current,
        localPhoneticResolved: Boolean(telemetry?.localPhoneticResolved),
        learnedMappingHit: Boolean(telemetry?.learnedMappingHit),
        deepSeekCalled: Boolean(telemetry?.deepSeekCalled),
        ambiguous: Boolean(telemetry?.ambiguous),
        manualCorrection: true,
        timeToSelectionMs: elapsed,
      }).catch(() => {
        // The query/product mapping is already durable; metrics remain best-effort.
      });

      setSearch('');
      searchInputRef.current?.blur();
      setChatResult({
        ...context.result,
        candidates: [],
        resolvedProductId: product.id,
        message: `Đã lưu cách gọi “${context.query}” → ${product.name} vào SALES AI LEARNING để duyệt.`,
      });
      setManualCorrectionContext(null);
    } catch (cause) {
      setCheckoutError(
        cause instanceof Error
          ? `Không lưu được cách gọi đã học: ${cause.message}. Hãy chọn lại sản phẩm để thử lại.`
          : 'Không lưu được cách gọi đã học. Hãy chọn lại sản phẩm để thử lại.',
      );
    } finally {
      setManualCorrectionSaving(false);
    }
  }

  function handleSalesChatSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = search.trim();
    if (!query || chatProcessing) return;
    setChatQuery(query);
    void processQuickAsk(query);
  }

  function handleVoiceInput() {
    if (voiceListening) return;
    voiceSessionRef.current?.cancel();
    if (voiceProcessTimerRef.current !== null) window.clearTimeout(voiceProcessTimerRef.current);
    voiceProcessTimerRef.current = null;
    setVoiceMessage('');

    voiceSessionRef.current = startSalesVoiceInput({
      onListeningChange: (listening) => {
        setVoiceListening(listening);
        if (listening) setVoiceMessage('Đang nghe…');
      },
      onError: (error) => setVoiceMessage(getSalesVoiceErrorMessage(error)),
      onTranscript: (transcript) => {
        setSearch(transcript);
        setChatQuery(transcript);
        setVoiceMessage('Đang phân tích…');
        voiceProcessTimerRef.current = window.setTimeout(() => {
          void processQuickAsk(transcript, true);
          voiceProcessTimerRef.current = null;
        }, 0);
      },
    });
  }

  function closeScanner(restoreSearchFocus = true) {
    setScannerOpen(false);
    if (restoreSearchFocus) requestAnimationFrame(() => searchInputRef.current?.focus());
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
    setChatQuery('');
    closeScanner(false);
    scrollProductIntoCheckout(match.product.id);
  }

  async function handleManualDrawerOpen() {
    if (!cashExpenseAvailable || submitting || checkoutSubmitRef.current || cashExpenseLocked || manualDrawerRef.current) return;
    manualDrawerRef.current = true;
    setManualDrawerBusy(true);
    setCheckoutError(null);
    setDraftMessage('');
    try {
      const warning = await openCashDrawerAfterTransaction(`POS_MANUAL_${crypto.randomUUID()}`, 'manual');
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
      pendingQuickSaleId,
      ...(selectedServiceId ? { selectedServiceId } : {}),
      quickAmountInput,
    });
    setDraftMessage('Đã lưu tạm trên thiết bị này. Dữ liệu tạm không đồng bộ sang thiết bị khác.');
    setCheckoutError(null);
  }

  function formatCompletedSaleNotice(sale: Sale, fallbackLabel?: string) {
    if (sale.saleKind === 'product') {
      const itemText = sale.items
        .map((item) => `${item.name} · SKU ${item.sku}`)
        .join(' / ');
      return `${itemText} · Thành tiền ${formatMoney(sale.total)}`;
    }
    return `${fallbackLabel || 'Dịch vụ'} · Thành tiền ${formatMoney(sale.total)}`;
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
    if (!appUser || submitting || checkoutSubmitRef.current || (cashExpenseAvailable && cashExpenseActive)) return;
    setPaymentMethod(nextPaymentMethod);
    setCheckoutError(null);
    setMessage(null);
    setDraftMessage('');

    if (!online) {
      setCheckoutError('Thiết bị đang offline. Hãy kết nối mạng trước khi chốt đơn để tránh giao dịch chưa đồng bộ.');
      return;
    }
    if (mixedIntent) {
      setCheckoutError('Nút thanh toán đang có cả hàng hóa và dịch vụ. Hãy hoàn tất hoặc bỏ một phần trước.');
      return;
    }
    if (!hasProductIntent && !hasQuickIntent) {
      setCheckoutError('Chưa có hàng hóa hoặc dịch vụ hợp lệ để thanh toán.');
      return;
    }

    if (hasQuickIntent && !hasProductIntent) {
      if (!selectedServiceId || quickAmount.state !== 'valid') return;
      if (discount !== 0) {
        setCheckoutError('Dịch vụ nhập nhanh không áp dụng giảm giá trong Phase 3A. Hãy đưa giảm giá về 0 trước khi lưu.');
        return;
      }

      checkoutSubmitRef.current = true;
      let saleId = pendingQuickSaleId;
      try {
        if (!saleId) {
          saleId = createSaleId();
          setPendingQuickSaleId(saleId);
        }
        setSubmitting(true);
        const sale = await createQuickServiceSale({
          saleId,
          serviceCategory: selectedServiceId,
          amount: quickAmount.amount,
          paymentMethod: nextPaymentMethod,
          ...(customerId ? { customerId } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        }, appUser.uid);

        const drawerWarning = nextPaymentMethod === 'cash'
          ? await openCashDrawerAfterTransaction(`POS_QUICK_${sale.id}`, 'quick_service')
          : null;
        setCheckoutError(drawerWarning);
        setLastCompletedSale(sale);
        setMessage(formatCompletedSaleNotice(sale, selectedService?.label || 'Dịch vụ'));
        scheduleSaleNoticeExpiry(sale.id);
        setSelectedServiceId(null);
        setQuickAmountInput('');
        setPendingQuickSaleId('');
        setCustomerId('');
        setNote('');
        setPaymentMethod('cash');
        scrollBackToSalesStart();
      } catch (cause) {
        setCheckoutError(
          `${cause instanceof Error ? cause.message : 'Không thể lưu giao dịch dịch vụ.'} ` +
          'Nếu bấm thử lại mà không đổi nội dung, hệ thống sẽ dùng lại cùng Sale ID để chống ghi hai lần.',
        );
      } finally {
        checkoutSubmitRef.current = false;
        setSubmitting(false);
      }
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
      const sale = await createSale({
        saleId,
        items: cartLines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
        discount,
        paymentMethod: nextPaymentMethod,
        ...(customerId ? { customerId } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      }, appUser.uid);

      const drawerWarning = nextPaymentMethod === 'cash'
        ? await openCashDrawerAfterTransaction(`POS_PRODUCT_${sale.id}`, 'product')
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
      setChatQuery('');
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

  async function handleQuickCancel(sale: Sale, originButton: HTMLButtonElement) {
    if (!appUser || busyQuickCancelId || sale.saleKind !== 'quick_service' || sale.status !== 'completed') return;
    if (appUser.role === 'staff' && sale.createdBy !== appUser.uid) return;
    if (!window.confirm(`Hủy giao dịch ${sale.code}? Giao dịch sẽ không còn được tính vào doanh thu.`)) return;

    setBusyQuickCancelId(sale.id);
    setCheckoutError(null);
    setMessage(null);
    try {
      const cancelled = await cancelQuickServiceSale(sale.id, { uid: appUser.uid, role: appUser.role });
      setLastCompletedSale((current) => current?.id === cancelled.id ? cancelled : current);
      setMessage(`${cancelled.code}: đã hủy giao dịch dịch vụ. Không có thay đổi tồn kho.`);
      requestAnimationFrame(() => recentHeadingRef.current?.focus());
    } catch (cause) {
      setCheckoutError(cause instanceof Error ? cause.message : 'Không thể hủy giao dịch dịch vụ.');
      requestAnimationFrame(() => originButton.focus());
    } finally {
      setBusyQuickCancelId(null);
    }
  }

  function renderSalesChatCard() {
    return (
        <section className="sales-chat-card" aria-labelledby="sales-chat-heading">
          <div className="sales-chat-heading">
            <span aria-hidden="true">?</span>
            <div>
              <h2 id="sales-chat-heading">Hỏi nhanh</h2>
              <small>Hỏi tồn kho, giá bán; chỉ tìm Internet khi bạn nói rõ “trên mạng / web / online…”</small>
            </div>
          </div>
          <form className="sales-chat-form" onSubmit={handleSalesChatSubmit}>
            <input
              ref={chatInputRef}
              type="text"
              value={chatQuery}
              onChange={(event) => {
                setChatQuery(event.currentTarget.value);
                setSearch(event.currentTarget.value);
              }}
              placeholder="Ví dụ: đệm 1m6 còn bao nhiêu"
              aria-label="Nhập câu hỏi nhanh về sản phẩm"
            />
            <button
              className="sales-chat-mic"
              type="button"
              aria-label="Nhập bằng giọng nói"
              aria-pressed={voiceListening}
              aria-busy={voiceListening}
              onClick={handleVoiceInput}
            >
              <span aria-hidden="true">🎙️</span>
            </button>
            <button type="submit" disabled={chatProcessing}>{chatProcessing ? 'Đang phân tích…' : 'Gửi'}</button>
          </form>
          {voiceMessage ? <p className="sales-chat-voice-status" role="status">{voiceMessage}</p> : null}
          {chatResult?.aiNotice ? <p className="sales-chat-voice-status" role="status">{chatResult.aiNotice}</p> : null}
          <div className="sales-chat-response" aria-live="polite" aria-atomic="true">
            {chatResult ? (
              <>
                <p><strong>“{chatResult.query}”</strong></p>
                {chatResult.candidates.length === 0 ? <p>{chatResult.message}</p> : null}
                {resolvedChatProduct ? (
                  <div className="sales-chat-resolved-product">
                    <ProductThumbnail product={resolvedChatProduct} className="sales-product-thumb sales-product-thumb--image sales-chat-resolved-product__image" eager />
                    <span>
                      <ProductNameMarquee name={resolvedChatProduct.name} />
                      <small>{resolvedChatProduct.sku} · {formatMoney(Number(resolvedChatProduct.salePrice) || 0)} · {Number(resolvedChatProduct.stockQuantity) > 0 ? `Tồn ${formatQuantity(Number(resolvedChatProduct.stockQuantity))}` : 'Hết hàng'}</small>
                    </span>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
          {chatResult?.telemetry?.explanations.length ? (
            <p className="sales-chat-understanding" role="status">
              <strong>Hiểu:</strong>{' '}
              {chatResult.telemetry.explanations
                .slice(0, 3)
                .map((item) => `${item.source} → ${item.target}`)
                .join(' · ')}
            </p>
          ) : null}

          {chatResult?.candidates.length ? (
            <div className="sales-chat-candidates" aria-label="Sản phẩm phù hợp">
              {chatResult.candidates.map(({ product, matchKind }, candidateIndex) => (
                <button
                  type="button"
                  key={product.id}
                  aria-label={chatResult.requestedMarketCompare
                    ? `Chọn ${product.name} để tìm giá Internet`
                    : chatResult.requestedAddToCart
                      ? `Chọn ${product.name} để xác nhận thêm vào hóa đơn`
                      : `Thêm ${product.name} vào giỏ hàng`}
                  onClick={() => {
                    if (chatResult.requestedMarketCompare || chatResult.requestedAddToCart) {
                      recordQuickAskSelection(product, chatResult, candidateIndex);
                    }
                    if (chatResult.requestedMarketCompare) {
                      const requestId = quickAskRequestIdRef.current + 1;
                      quickAskRequestIdRef.current = requestId;
                      setChatProcessing(true);
                      const baseResult: HybridSalesChatResult = {
                        ...chatResult,
                        candidates: [],
                        resolvedProductId: product.id,
                        message: `Đã chọn ${product.name}. Đang tìm giá trên Internet…`,
                      };
                      setChatResult(baseResult);
                      void runMarketComparison(chatResult.query, product, baseResult, requestId)
                        .finally(() => {
                          if (quickAskRequestIdRef.current === requestId) setChatProcessing(false);
                        });
                      return;
                    }

                    if (chatResult.requestedAddToCart) {
                      const quantity = chatResult.requestedAddToCart.quantity;
                      setChatResult({
                        ...chatResult,
                        message: `Thêm ${formatQuantity(quantity)} × ${product.name} vào hóa đơn?`,
                        candidates: [],
                        fuzzySuggestion: false,
                        requestedAddToCart: { quantity, productId: product.id },
                      });
                      return;
                    }

                    const stock = Number(product.stockQuantity) || 0;
                    const nextQuantity = roundQuantity((cart[product.id] ?? 0) + 1);
                    const canAdd = product.active && stock > 0 && nextQuantity <= stock;
                    addProduct(product);
                    if (!canAdd) return;
                    recordQuickAskAdd(product, chatResult, candidateIndex, cart[product.id] ?? 0);
                    setChatResult({
                      ...chatResult,
                      message: answerSalesChatProduct(product, chatResult.intent),
                      candidates: [],
                      fuzzySuggestion: false,
                      resolvedProductId: product.id,
                    });
                    scrollProductIntoCheckout(product.id);
                  }}
                >
                  <ProductThumbnail product={product} className="sales-product-thumb sales-product-thumb--image sales-chat-candidate__image" />
                  <span className="sales-chat-candidate__identity"><ProductNameMarquee name={product.name} /><small>{product.sku} · {matchKind.startsWith('fuzzy-') ? 'Gợi ý gần' : 'Phù hợp'}</small></span>
                  <span className="sales-chat-candidate__meta">{formatMoney(Number(product.salePrice) || 0)}<small>{Number(product.stockQuantity) > 0 ? `Tồn ${formatQuantity(Number(product.stockQuantity))}` : 'Hết hàng'}</small></span>
                </button>
              ))}
            </div>
          ) : null}

          {chatResult && !chatProcessing && !manualCorrectionContext ? (
            <button
              type="button"
              className="sales-chat-manual-button"
              onClick={startManualCorrection}
            >
              {chatResult.resolvedProductId ? 'Sửa kết quả / tìm thủ công' : 'Không đúng? Tìm thủ công'}
            </button>
          ) : null}

          {marketPriceError ? (
            <p className="sales-chat-market-error" role="status">{marketPriceError}</p>
          ) : null}

          {marketPriceComparison ? (
            <div className="sales-chat-market" aria-label="So sánh giá Internet">
              <div className="sales-chat-market__summary">
                <strong>So sánh giá Internet</strong>
                <span>Giá cửa hàng: {formatMoney(marketPriceComparison.localPrice)}</span>
                {marketPriceComparison.marketMedian !== null ? (
                  <span>Trung vị tham khảo: {formatMoney(marketPriceComparison.marketMedian)}</span>
                ) : (
                  <span>Chưa đủ dữ liệu giá đáng tin cậy.</span>
                )}
              </div>
              {marketPriceComparison.sources.length ? (
                <div className="sales-chat-market__sources">
                  {marketPriceComparison.sources.map((source) => (
                    <a
                      key={`${source.url}-${source.price}`}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span>{source.title}</span>
                      <strong>{formatMoney(source.price)}</strong>
                    </a>
                  ))}
                </div>
              ) : null}
              <small>Giá Internet chỉ mang tính tham khảo; hãy mở nguồn để kiểm tra đúng mẫu, kích thước và điều kiện bán.</small>
            </div>
          ) : null}

          {chatResult?.requestedAddToCart?.productId ? (() => {
            const product = productById.get(chatResult.requestedAddToCart.productId);
            if (!product) return null;
            const quantity = chatResult.requestedAddToCart.quantity;
            return (
              <div className="sales-chat-confirm" role="group" aria-label="Xác nhận thêm sản phẩm vào hóa đơn">
                <button
                  type="button"
                  onClick={() => {
                    const quantityBefore = cart[product.id] ?? 0;
                    const added = addProductQuantity(product, quantity);
                    if (!added) return;
                    recordQuickAskAdd(product, chatResult, undefined, quantityBefore);
                    setChatResult({
                      ...chatResult,
                      message: `Đã thêm ${formatQuantity(quantity)} × ${product.name} vào hóa đơn.`,
                      requestedAddToCart: undefined,
                    });
                    scrollProductIntoCheckout(product.id);
                  }}
                >
                  Xác nhận thêm
                </button>
                <button
                  type="button"
                  className="sales-chat-confirm__cancel"
                  onClick={() => setChatResult({ ...chatResult, message: 'Đã hủy yêu cầu thêm vào hóa đơn.', requestedAddToCart: undefined })}
                >
                  Hủy
                </button>
              </div>
            );
          })() : null}
        </section>
    );
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
      {topbarNotificationHost ? createPortal(
        <div className="sales-topbar-notices" aria-live="polite">
          {customerError ? <div className="sales-inline-warning">Không tải được danh sách khách hàng; vẫn có thể bán cho khách lẻ.</div> : null}
          {checkoutError ? <div className="sales-error" role="alert"><span>{checkoutError}</span></div> : null}
          {mixedIntent ? (
            <div className="sales-warning" role="status">
              <strong>Không hỗ trợ hóa đơn trộn trong Phase 3A.</strong>
              <span>Đang có cả hàng hóa và dịch vụ. Hãy hoàn tất hoặc bỏ một phần trước khi thanh toán.</span>
            </div>
          ) : null}
          {cartIssues.length > 0 ? (
            <div className="sales-warning" role="status">
              <strong>Hóa đơn cần cập nhật trước khi thanh toán:</strong>
              <span>{cartIssues[0]}</span>
            </div>
          ) : null}
          {draftMessage ? <div className="sales-success" role="status">{draftMessage}</div> : null}
          {message ? (
            <div className={`sales-success${lastCompletedSale ? ' sales-order-notice' : ''}`} role="status">
              <span className={lastCompletedSale ? 'sales-order-notice__summary' : undefined}>{message}</span>
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
      ) : null}
      <div className="sales-shell sales-pos-shell">
      <section className="sales-pos-context" aria-label="Thông tin phiên bán hàng">
        <div>
          <span className="sales-pos-context__label">Bán hàng nhanh</span>
          <strong>{appUser?.displayName || 'Nhân viên'}</strong>
        </div>
        <span className={`sales-connectivity ${online ? 'sales-connectivity--online' : 'sales-connectivity--offline'}`}>
          {online ? 'Trực tuyến' : 'Mất kết nối'}
        </span>
      </section>

      {search || chatResult || marketPriceComparison || marketPriceError || voiceMessage ? (
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
            setChatQuery('');
            setChatResult(null);
            setMarketPriceComparison(null);
            setMarketPriceError('');
            setVoiceMessage('');
            searchInputRef.current?.blur();
          }}
        />
      ) : null}

      <section className="sales-search-area" aria-label="Tìm hàng hóa">
        <div className="sales-search-row sales-unified-search-row">
          <div className="sales-search-box">
            <span className="sales-search-icon" aria-hidden="true"><PosActionIcon name="search" /></span>
            <input
              ref={searchInputRef}
              autoComplete="off"
              inputMode="search"
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setChatQuery(event.target.value);
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder="Tìm hàng theo tên, SKU, barcode hoặc QR… (F3)"
              aria-label="Tìm hàng hóa bằng tên, SKU, barcode hoặc QR"
            />
            {search ? (
              <button type="button" onClick={() => { setSearch(''); setChatQuery(''); }} aria-label="Xóa tìm kiếm">×</button>
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
        {manualCorrectionContext ? (
          <div className="sales-manual-correction-status" role="status">
            <span>
              {manualCorrectionSaving ? 'Đang lưu cách gọi: ' : 'Chọn sản phẩm đúng cho: '}
              <strong>“{manualCorrectionContext.query}”</strong>
            </span>
            <button type="button" disabled={manualCorrectionSaving} onClick={cancelManualCorrection}>Hủy sửa</button>
          </div>
        ) : null}

        {productsError ? (
          <div className="sales-error" role="alert">
            <span>{productsError}</span>
            <button type="button" onClick={() => setDataRetryNonce((value) => value + 1)}>Thử lại</button>
          </div>
        ) : null}

        <div className="sales-search-overlay-stack">
        {search ? (
          <div className="sales-search-results" aria-label="Kết quả tìm hàng hóa">
            {productsLoading ? (
              <div className="sales-empty">Đang tải sản phẩm...</div>
            ) : searchResults.length === 0 ? (
              <div className="sales-empty">Không tìm thấy hàng hóa phù hợp.</div>
            ) : (
              searchResults.map(({ product, kind }) => {
                const outOfStock = Number(product.stockQuantity) <= 0;
                return (
                  <button
                    type="button"
                    className="sales-search-result"
                    key={product.id}
                    disabled={manualCorrectionSaving || (!manualCorrectionContext && outOfStock)}
                    onClick={() => {
                      if (manualCorrectionContext) {
                        void chooseManualCorrectionProduct(product);
                        return;
                      }
                      addProduct(product);
                      setSearch('');
                      setChatQuery('');
                      searchInputRef.current?.blur();
                      scrollProductIntoCheckout(product.id);
                    }}
                  >
                    <ProductThumbnail product={product} className="sales-product-thumb sales-product-thumb--image" />
                    <span className="sales-search-result__identity">
                      <ProductNameMarquee name={product.name} continuous />
                      <small>{product.sku}{product.barcode ? ` · ${product.barcode}` : ''}</small>
                    </span>
                    <span className="sales-search-result__meta">
                      <strong>{formatMoney(Number(product.salePrice) || 0)}</strong>
                      <small>{outOfStock ? 'Hết hàng' : `Tồn ${formatQuantity(Number(product.stockQuantity) || 0)}`} · {kind}</small>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        ) : null}
          <div ref={setSearchAiHostRef} className="sales-search-ai-host" />
        </div>

        {scannerOpen ? (
          <div className="sales-scanner-panel">
            <div className="sales-scanner-panel__head">
              <div>
                <strong>Quét QR / barcode</strong>
                <span>Quét thành công sẽ thêm Product vào hóa đơn.</span>
              </div>
              <button type="button" onClick={() => closeScanner()}>Đóng</button>
            </div>
            <BarcodeScanner onScan={(result) => handleCameraScan(result.value)} />
          </div>
        ) : null}
      </section>

      <section
        className={`sales-service-grid${widePosLayout && tabletCartLines.length > 0 ? ' sales-service-grid--products' : ''}`}
        aria-label={widePosLayout && tabletCartLines.length > 0 ? 'Hàng hóa đang chọn' : 'Dịch vụ nhập nhanh'}
      >
        {widePosLayout && tabletCartLines.length > 0 ? (
          <div ref={productPagesRef} className="sales-selected-product-pages" aria-label={`${tabletCartLines.length} hàng hóa đang chọn, vuốt ngang để xem thêm`}>
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
                      <strong className="sales-selected-product-tile__price">{formatMoney(Number(product.salePrice) || 0)}</strong>
                      <span className="sales-selected-product-tile__qty">×{formatQuantity(line.quantity)}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <div className="sales-empty">Quét mã hoặc tìm hàng để thêm vào hóa đơn.</div>
        }
      </section>

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
        {widePosLayout && (cashExpenseMode || selectedServiceId || hasProductIntent) ? (
          <label className="sales-cash-expense-service-note">
            <span className="sales-field-heading">
              <span aria-hidden="true">▧</span>
              <strong>{cashExpenseMode ? 'Ghi chú / lý do xuất tiền (không bắt buộc)' : 'Ghi chú / địa chỉ khách (không bắt buộc)'}</strong>
            </span>
            <textarea
              rows={2}
              maxLength={200}
              value={shownNote}
              disabled={cashExpenseMode && cashExpenseInputLocked}
              onChange={(event) => changeShownNote(event.target.value)}
              placeholder={cashExpenseMode ? "Nhập lý do xuất tiền…" : "Nhập ghi chú, địa chỉ giao hàng / địa chỉ khách..."}
            />
            <small>{shownNote.length}/200</small>
          </label>
        ) : null}
      </div>

      <div className="sales-invoice-overview--tablet">
        <div className="sales-invoice-title sales-invoice-title--tablet" aria-label="Thông tin hóa đơn hiện tại">
          <span className="sales-invoice-icon" aria-hidden="true">▤</span>
          <div>
            <strong>Hóa đơn 1</strong>
            <span>{cartLines.length} mặt hàng{pendingSaleId || pendingQuickSaleId ? ' · đang giữ mã retry an toàn' : ''}</span>
          </div>
        </div>

        <label className="sales-customer-picker sales-customer-picker--tablet" aria-label="Chọn khách hàng">
          <select value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
            <option value="">Khách lẻ</option>
            {customers.map((customer) => (
              <option value={customer.id} key={customer.id}>
                {customer.name}{customer.phone ? ` · ${customer.phone}` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section ref={invoiceCardRef} tabIndex={-1} className="sales-invoice-card" aria-labelledby="sales-invoice-heading">
        <div className="sales-invoice-header">
          <div className="sales-invoice-title sales-invoice-title--invoice">
            <span className="sales-invoice-icon" aria-hidden="true">▤</span>
            <div>
              <h1 id="sales-invoice-heading">Hóa đơn 1</h1>
              <span>{cartLines.length} mặt hàng{pendingSaleId || pendingQuickSaleId ? ' · đang giữ mã retry an toàn' : ''}</span>
            </div>
          </div>

          <label className="sales-customer-picker">
            <span>Thêm / chọn khách hàng</span>
            <select value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
              <option value="">Khách lẻ</option>
              {customers.map((customer) => (
                <option value={customer.id} key={customer.id}>
                  {customer.name}{customer.phone ? ` · ${customer.phone}` : ''}
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
          <div className="sales-empty sales-empty--cart">Tìm hoặc quét Product để thêm vào hóa đơn.</div>
        ) : (
          <div className="sales-cart-list">
            {cartLines.map((line) => {
              const product = line.product;
              if (!product) {
                return (
                  <article className="sales-cart-line sales-cart-line--invalid" key={line.productId}>
                    <span className="sales-product-thumb" aria-hidden="true">⚠️</span>
                    <div className="sales-cart-line__identity">
                      <strong>Sản phẩm không còn tồn tại</strong>
                      <span>{line.productId}</span>
                    </div>
                    <button className="sales-remove-line" type="button" onClick={() => removeLine(line.productId)} aria-label="Xóa sản phẩm không còn tồn tại">×</button>
                  </article>
                );
              }

              const lineTotal = Math.round(line.quantity * (Number(product.salePrice) || 0));
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
                  <ProductThumbnail product={product} className="sales-product-thumb sales-product-thumb--image" eager />
                  <div className="sales-cart-line__identity">
                    <strong>{product.name}</strong>
                    <span>{product.sku}{product.unit ? ` · ${product.unit}` : ''}</span>
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
                      <button type="button" aria-label={`Giảm số lượng ${product.name}`} onClick={() => setLineQuantity(product, line.quantity - 1)}>−</button>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0.001"
                        step="0.001"
                        max={Number(product.stockQuantity) || undefined}
                        value={line.quantity}
                        aria-label={`Số lượng ${product.name}`}
                        onChange={(event) => setLineQuantity(product, event.currentTarget.valueAsNumber)}
                      />
                      <button type="button" aria-label={`Tăng số lượng ${product.name}`} onClick={() => setLineQuantity(product, line.quantity + 1)}>+</button>
                    </div>
                    <div className="sales-cart-line__price">
                      <small>× {formatMoney(Number(product.salePrice) || 0)}</small>
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
            <div className="sales-field-heading"><span aria-hidden="true">↗</span><div>
              <strong>Nhập số tiền xuất</strong><small>Nhập theo nghìn đồng · 125 = 125.000đ</small>
            </div></div>
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
          ) : selectedService ? (
            <div className="sales-field-heading">
              <span aria-hidden="true">◉</span>
              <div>
                <strong>Nhập nhanh số tiền</strong>
                <small>Đang chọn: {selectedService.label}</small>
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
              value={cashExpenseMode ? cashExpenseAmount : hasProductIntent ? (discount > 0 ? String(discount) : '') : quickAmountInput}
              disabled={amountInputDisabled}
              onFocus={(event) => {
                if (tabletPosLayout) event.currentTarget.blur();
              }}
              onChange={(event) => {
                if (tabletPosLayout) return;
                if (cashExpenseMode) {
                  if (!cashExpenseInputLocked) setCashExpenseAmount(event.currentTarget.value.replace(/\D/g, '').slice(0, 9));
                  return;
                }
                if (hasProductIntent) {
                  const digits = event.currentTarget.value.replace(/\D/g, '').slice(0, 9);
                  const next = Number(digits || 0);
                  fastDiscountRef.current = next;
                  setDiscount(next);
                  return;
                }
                fastQuickAmountRef.current = event.currentTarget.value;
                setQuickAmountInput(event.currentTarget.value);
              }}
              placeholder={cashExpenseMode ? 'Ví dụ 125 = 125.000đ' : hasProductIntent ? 'Nhập giảm giá (VND)' : (selectedService ? 'Ví dụ 199 = 199.000đ' : 'Chọn dịch vụ trước')}
              aria-label={cashExpenseMode ? 'Nhập số tiền xuất theo đơn vị nghìn đồng' : hasProductIntent ? 'Nhập nhanh giảm giá bằng VND' : 'Nhập nhanh số tiền theo đơn vị nghìn đồng'}
            />
            <span className="sales-quick-amount-preview">
              {cashExpenseMode
                ? formatMoney(cashExpenseStatus.pending?.amount ?? cashExpenseAmountVnd)
                : hasProductIntent
                ? formatMoney(discount)
                : quickAmount.state === 'valid'
                  ? formatMoney(quickAmount.amount)
                  : '× 1.000đ'}
            </span>
          </div>
          <div className="sales-tablet-keypad" aria-label={cashExpenseMode ? 'Bàn phím nhập số tiền xuất' : hasProductIntent ? 'Bàn phím nhập giảm giá trên tablet' : 'Bàn phím nhập số tiền trên tablet'}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
              <button
                key={digit}
                type="button"
                disabled={amountInputDisabled}
                onPointerDown={(event) => handleNumpadPointerDown(event, () => appendQuickAmountDigit(digit))}
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
              onPointerDown={(event) => handleNumpadPointerDown(event, clearQuickAmount)}
              onClick={(event) => {
                if (event.detail === 0) clearQuickAmount();
              }}
            >
              C
            </button>
            <button
              type="button"
              disabled={amountInputDisabled}
              onPointerDown={(event) => handleNumpadPointerDown(event, () => appendQuickAmountDigit('0'))}
              onClick={(event) => {
                if (event.detail === 0) appendQuickAmountDigit('0');
              }}
            >
              0
            </button>
            <button
              type="button"
              disabled={amountInputDisabled}
              onPointerDown={(event) => handleNumpadPointerDown(event, removeQuickAmountDigit)}
              onClick={(event) => {
                if (event.detail === 0) removeQuickAmountDigit();
              }}
              aria-label="Xóa một số"
            >
              ⌫
            </button>
          </div>
          {!cashExpenseMode && !hasProductIntent && quickAmount.state === 'invalid' ? <p className="sales-field-error">{quickAmount.message}</p> : null}
        </div>

        {(!widePosLayout || cashExpenseMode || selectedServiceId || hasProductIntent) ? (
        <label className="sales-note-field sales-note-field--invoice">
          <span className="sales-field-heading">
            <span aria-hidden="true">▧</span>
            <strong>{cashExpenseMode ? 'Ghi chú / lý do xuất tiền (không bắt buộc)' : 'Ghi chú / địa chỉ khách (không bắt buộc)'}</strong>
          </span>
          <textarea
            rows={2}
            maxLength={200}
            value={shownNote}
            disabled={cashExpenseMode && cashExpenseInputLocked}
            onChange={(event) => changeShownNote(event.target.value)}
            placeholder={cashExpenseMode ? "Nhập lý do xuất tiền…" : "Nhập ghi chú, địa chỉ giao hàng / địa chỉ khách..."}
          />
          <small>{shownNote.length}/200</small>
        </label>
        ) : null}

        <div className="sales-summary" hidden={cashExpenseMode}>
          <div>
            <span>{!hasProductIntent && hasQuickIntent ? 'Tiền dịch vụ' : 'Tổng tiền hàng'}</span>
            <strong>{formatMoney(checkoutSubtotal)}</strong>
          </div>
          <div className="sales-discount-field">
            <VndMoneyInput
              label="Giảm giá đơn (VND)"
              ariaLabel="Giảm giá bằng số tiền VND"
              value={discount}
              readOnly={tabletPosLayout}
              onChange={(value) => setDiscount(Math.max(0, Math.round(Number(value) || 0)))}
              className="sales-discount-input"
              labelClassName="sales-discount-label"
            />
          </div>
          <div className="sales-summary__payable">
            <span>Khách cần trả</span>
            <strong>{formatMoney(payable)}</strong>
          </div>
        </div>

        <div ref={paymentGridRef} className="sales-payment-grid" aria-label="Thanh toán">
          <button
            className={`sales-payment-button sales-payment-button--cash${!cashExpenseMode && paymentMethod === 'cash' ? ' is-selected' : ''}`}
            type="button"
            aria-disabled={submitting || !online || (cashExpenseMode ? cashExpenseStatus.saving || (cashExpenseStatus.pending ? cashExpenseStatus.pending.method !== 'cash' : cashExpenseAmountVnd <= 0) : mixedIntent || (!hasProductIntent && !hasQuickIntent) || cartIssues.length > 0 || (hasProductIntent ? discount > subtotal : discount !== 0))}
            aria-busy={cashExpenseMode ? cashExpenseStatus.saving : submitting && paymentMethod === 'cash'}
            onClick={() => void handleCheckout('cash')}
          >
            <PosActionIcon name="cash" />
            <span><strong>Tiền mặt</strong><small>{cashExpenseMode ? cashExpenseStatus.saving ? 'Đang lưu…' : cashExpenseStatus.pending ? 'Thử lại khoản xuất' : 'Xác nhận xuất tiền mặt' : submitting && paymentMethod === 'cash' ? 'Đang xử lý...' : 'Thanh toán bằng tiền mặt'}</small></span>
          </button>
          <button
            className={`sales-payment-button sales-payment-button--bank${!cashExpenseMode && paymentMethod === 'bank_transfer' ? ' is-selected' : ''}`}
            type="button"
            aria-disabled={submitting || !online || (cashExpenseMode ? cashExpenseStatus.saving || (cashExpenseStatus.pending ? cashExpenseStatus.pending.method !== 'bank_transfer' : cashExpenseAmountVnd <= 0) : mixedIntent || (!hasProductIntent && !hasQuickIntent) || cartIssues.length > 0 || (hasProductIntent ? discount > subtotal : discount !== 0))}
            aria-busy={cashExpenseMode ? cashExpenseStatus.saving : submitting && paymentMethod === 'bank_transfer'}
            onClick={() => void handleCheckout('bank_transfer')}
          >
            <PosActionIcon name="bankTransfer" />
            <span><strong>Chuyển khoản</strong><small>{cashExpenseMode ? cashExpenseStatus.saving ? 'Đang lưu…' : cashExpenseStatus.pending ? 'Thử lại khoản xuất' : 'Xác nhận xuất chuyển khoản' : submitting && paymentMethod === 'bank_transfer' ? 'Đang xử lý...' : 'Thanh toán qua ngân hàng'}</small></span>
          </button>
        </div>

        <div className={`sales-secondary-actions${cashExpenseAvailable ? ' sales-secondary-actions--drawer' : ''}`}>
          <button type="button" disabled={cashExpenseMode} onClick={handleSaveDraft}>
            <PosActionIcon name="draft" />
            <span><strong>Lưu tạm</strong><small>Lưu trên thiết bị này</small></span>
          </button>
          {cashExpenseAvailable ? (
            <button className="sales-manual-drawer-button" type="button"
              disabled={!cashExpenseAvailable || submitting || cashExpenseLocked || manualDrawerBusy}
              aria-busy={manualDrawerBusy}
              onClick={() => void handleManualDrawerOpen()}>
              <PosActionIcon name="cash" />
              <span><strong>{manualDrawerBusy ? 'Đang gửi…' : 'Mở két'}</strong><small>Mở két tiền</small></span>
            </button>
          ) : null}
        </div>

      </section>

      <section className="sales-recent-card" aria-labelledby="sales-recent-heading">
        <div className="sales-recent-header">
          <div>
            <span className="sales-recent-icon" aria-hidden="true">◷</span>
            <h2 ref={recentHeadingRef} id="sales-recent-heading" tabIndex={-1}>Lịch sử giao dịch <small>(4 gần nhất)</small></h2>
          </div>
          <button type="button" onClick={openHistory}>Xem toàn bộ</button>
        </div>

        {recentError ? <div className="sales-error" role="alert"><span>{recentError}</span></div> : null}
        {!recentError && recentSales.length === 0 ? (
          <div className="sales-empty">Chưa có giao dịch bán hàng.</div>
        ) : (
          <div className="sales-recent-list">
            {recentSales.map((sale) => {
              const summary = summarizeRecentSale(sale);
              const canCancelQuick = sale.saleKind === 'quick_service'
                && sale.status === 'completed'
                && Boolean(appUser && (appUser.role === 'owner' || sale.createdBy === appUser.uid));
              return (
                <article className="sales-recent-row" key={sale.id}>
                  <time dateTime={new Date(sale.createdAt).toISOString()}>{formatTime(sale.createdAt)}</time>
                  <div className="sales-recent-row__main">
                    <strong>{summary.label}</strong>
                    <small>{summary.note || sale.code}</small>
                  </div>
                  <span className="sales-recent-row__qty">{summary.quantity == null ? '—' : `×${formatQuantity(summary.quantity)}`}</span>
                  <strong className="sales-recent-row__amount">{formatMoney(sale.total)}</strong>
                  <span className={`sales-status sales-status--${sale.status}`}>{sale.status === 'completed' ? 'Hoàn tất' : sale.status === 'cancelled' ? 'Đã hủy' : 'Đã hoàn'}</span>
                  {canCancelQuick ? (
                    <button
                      className="sales-link-button"
                      type="button"
                      aria-disabled={busyQuickCancelId === sale.id}
                      aria-busy={busyQuickCancelId === sale.id}
                      onClick={(event) => void handleQuickCancel(sale, event.currentTarget)}
                    >
                      {busyQuickCancelId === sale.id ? 'Đang hủy…' : 'Hủy'}
                    </button>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
        <p className="sales-recent-note">4 giao dịch gần nhất đọc từ server. Quick Service có thể hủy theo quyền; không xóa vật lý.</p>
      </section>
      </div>
    </>
  );
}

