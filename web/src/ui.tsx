import {
  useEffect,
  useId,
  useRef,
  useState,
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import {
  Eye,
  EyeOff,
  Home,
  BookOpen,
  ChartColumn,
  Wallet,
  Settings,
  Users,
  LockKeyhole,
  Plus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowRight,
  Search,
  SlidersHorizontal,
  CalendarDays,
  List,
  LogOut,
  Leaf,
  ShieldCheck,
  Camera,
  X,
  Check,
  Download,
  Trash2,
  RotateCcw,
  Building2,
  CreditCard,
  User,
  Sun,
  Moon,
  LoaderCircle,
  Copy,
  KeyRound,
  Info,
  FolderArchive,
  FileJson,
  FileSpreadsheet,
  MoreHorizontal,
  Coffee,
  Utensils,
  ShoppingBasket,
  Bus,
  Heart,
  ShoppingBag,
  Briefcase,
  ArrowLeftRight,
} from "lucide-react";
const icons = {
  home: Home,
  book: BookOpen,
  chart: ChartColumn,
  wallet: Wallet,
  settings: Settings,
  people: Users,
  lock: LockKeyhole,
  plus: Plus,
  down: ChevronDown,
  left: ChevronLeft,
  right: ChevronRight,
  up: ArrowUpRight,
  in: ArrowDownLeft,
  arrow: ArrowRight,
  search: Search,
  filter: SlidersHorizontal,
  calendar: CalendarDays,
  list: List,
  logout: LogOut,
  leaf: Leaf,
  shield: ShieldCheck,
  camera: Camera,
  close: X,
  check: Check,
  download: Download,
  trash: Trash2,
  restore: RotateCcw,
  bank: Building2,
  card: CreditCard,
  user: User,
  sun: Sun,
  moon: Moon,
  loader: LoaderCircle,
  copy: Copy,
  key: KeyRound,
  info: Info,
  archive: FolderArchive,
  json: FileJson,
  csv: FileSpreadsheet,
  more: MoreHorizontal,
  coffee: Coffee,
  food: Utensils,
  groceries: ShoppingBasket,
  transport: Bus,
  health: Heart,
  shopping: ShoppingBag,
  salary: Briefcase,
  transfer: ArrowLeftRight,
};
export type IconName = keyof typeof icons;
export function Icon({
  name,
  ...props
}: {
  name: IconName;
  className?: string;
  size?: number;
}) {
  const C = icons[name] || MoreHorizontal;
  return <C aria-hidden="true" strokeWidth={1.7} {...props} />;
}
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? "mini-brand" : "brand"}>
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
      </span>
      <span>
        듀엣 가계부
        {!compact && (
          <span className="brand-subtitle">우리의 일상을 기록하다</span>
        )}
      </span>
    </span>
  );
}
export function Privacy({ shared }: { shared: boolean }) {
  return (
    <span className={"privacy-badge " + (shared ? "shared" : "")}>
      <Icon name={shared ? "people" : "lock"} />
      {shared ? "함께 보기" : "나만 보기"}
    </span>
  );
}
export function Modal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const headingId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    const listener = () => onClose();
    d.addEventListener("close", listener);
    return () => {
      d.removeEventListener("close", listener);
      d.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-labelledby={headingId}
      className="info-dialog real-dialog"
    >
      <div className="dialog-head">
        <div>
          <h2 id={headingId}>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="icon-button" onClick={onClose} aria-label="닫기">
          <Icon name="close" />
        </button>
      </div>
      <div className="dialog-content">{children}</div>
    </dialog>
  );
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Icon name="book" />
      <h3>{title}</h3>
      <p>{description}</p>
      {children && <div style={{ marginTop: 20 }}>{children}</div>}
    </div>
  );
}
export function ErrorText({ error }: { error: string }) {
  return error ? (
    <p className="error-message" role="alert">
      {error}
    </p>
  ) : null;
}
export function Busy({
  busy,
  children,
}: {
  busy: boolean;
  children: ReactNode;
}) {
  return (
    <>
      {busy ? (
        <>
          <Icon name="loader" className="spin" />
          처리 중…
        </>
      ) : (
        children
      )}
    </>
  );
}

export const PasswordInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function PasswordInput({ className = "field-input", ...props }, ref) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="password-field">
      <input
        {...props}
        name={props.name || props.id}
        ref={ref}
        className={className}
        type={visible ? "text" : "password"}
      />
      <button
        type="button"
        className="password-toggle"
        aria-label={visible ? "비밀번호 숨기기" : "비밀번호 보기"}
        aria-pressed={visible}
        onClick={() => setVisible(!visible)}
      >
        {visible ? (
          <EyeOff aria-hidden="true" size={18} />
        ) : (
          <Eye aria-hidden="true" size={18} />
        )}
      </button>
    </span>
  );
});

export function Help({ children }: { children: ReactNode }) {
  const id = useId();
  return (
    <span className="help-wrap">
      <button
        type="button"
        className="help-button"
        aria-label="도움말"
        aria-describedby={id}
      >
        <Icon name="info" size={16} />
      </button>
      <span id={id} role="tooltip" className="help-tip">
        {children}
      </span>
    </span>
  );
}
