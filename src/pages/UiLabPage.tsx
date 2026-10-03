import { useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, Checkbox, EmptyState, FormField, IconButton, Input, LoadingState, SearchField, Select, StatusMessage, Textarea } from '../shared/ui/primitives';
import { Dialog } from '../shared/ui/dialog';
import { CompactList, ResponsiveDataTable, ScrollableDataTable, type DataColumn } from '../shared/ui/tables';
import './ui-lab.css';

type DemoRow = { id: string; sku: string; name: string; stock: number; status: string };

const demoRows: DemoRow[] = [
  { id: '1', sku: 'SP001', name: 'Bàn học giá sách 80 hồng', stock: 8, status: 'Đang bán' },
  { id: '2', sku: 'SP002', name: 'Giá đa năng 4 tầng', stock: 2, status: 'Sắp hết' },
  { id: '3', sku: 'SP003', name: 'Chăn hè 2m x 2m2', stock: 0, status: 'Hết hàng' },
];

export default function UiLabPage() {
  const [query, setQuery] = useState('');
  const [fieldQuery, setFieldQuery] = useState('bàn học');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const initialDialogFocusRef = useRef<HTMLInputElement | null>(null);

  const rows = useMemo(
    () => demoRows.filter((row) => `${row.sku} ${row.name}`.toLocaleLowerCase('vi').includes(query.toLocaleLowerCase('vi'))),
    [query],
  );

  const columns: DataColumn<DemoRow>[] = [
    { key: 'sku', header: 'Mã hàng', render: (row) => row.sku },
    { key: 'name', header: 'Tên hàng', render: (row) => row.name },
    { key: 'stock', header: 'Tồn kho', render: (row) => row.stock },
    { key: 'status', header: 'Trạng thái', render: (row) => <Badge tone={row.stock === 0 ? 'danger' : row.stock <= 2 ? 'warning' : 'success'}>{row.status}</Badge> },
  ];

  return (
    <div className="ui-lab">
      <header className="ui-lab__hero">
        <div>
          <p className="ui-lab__eyebrow">Design System Foundation</p>
          <h1>UI Lab</h1>
          <p>Prototype presentation-only. Không thay AppLayout production và không tác động logic bán hàng/kho/in ấn.</p>
        </div>
        <Badge tone="info">Breakpoint shell: 860px</Badge>
      </header>

      <section className="ui-lab-shell" aria-label="Prototype responsive shell">
        <aside className="ui-lab-shell__sidebar" aria-label="Sidebar mẫu">
          <strong>Minh Điến</strong>
          <span>Tổng quan</span><span>Hàng hóa</span><span>Bán hàng</span><span>Kho</span>
        </aside>
        <main className="ui-lab-shell__content">
          <div className="ui-lab__grid">
            <Card><strong>Primary</strong><p>Semantic token, không hard-code module.</p><Button>Mặc định</Button></Card>
            <Card><strong>States</strong><div className="ui-lab__inline"><Badge tone="success">Thành công</Badge><Badge tone="warning">Cảnh báo</Badge><Badge tone="danger">Nguy hiểm</Badge><Badge tone="info">Thông tin</Badge></div></Card>
          </div>

          <Card>
            <h2>Button & IconButton</h2>
            <p>Di chuột để kiểm tra hover, giữ chuột để xem active và dùng phím Tab để kiểm tra focus ring.</p>
            <h3>Button variants</h3>
            <div className="ui-lab__inline">
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
              <Button disabled>Disabled</Button>
              <Button ariaDisabled>aria-disabled</Button>
            </div>
            <h3>IconButton · 44 × 44</h3>
            <div className="ui-lab__inline">
              <IconButton label="Tìm kiếm" variant="ghost">⌕</IconButton>
              <IconButton label="Thêm mới">＋</IconButton>
              <IconButton label="Xóa" variant="danger">×</IconButton>
              <IconButton label="Đã vô hiệu hóa" variant="secondary" disabled>•••</IconButton>
            </div>
          </Card>

          <Card>
            <h2>Input & SearchField</h2>
            <p>Hover làm rõ viền; focus dùng vòng vàng semantic; disabled giữ trạng thái đọc được nhưng không tương tác.</p>
            <div className="ui-lab__form-grid">
              <FormField label="Input mặc định" htmlFor="lab-input-state" hint="Dùng Tab để kiểm tra focus ring.">
                <Input id="lab-input-state" placeholder="Nhập nội dung" />
              </FormField>
              <FormField label="Input disabled" htmlFor="lab-input-disabled" hint="Không nhận focus và không cho nhập.">
                <Input id="lab-input-disabled" value="Không thể chỉnh sửa" disabled readOnly />
              </FormField>
              <FormField label="SearchField" htmlFor="lab-search-state" hint="Có nút xóa khi đang có nội dung.">
                <SearchField id="lab-search-state" value={fieldQuery} onChange={(event) => setFieldQuery(event.target.value)} onClear={() => setFieldQuery('')} placeholder="Tìm sản phẩm" />
              </FormField>
              <FormField label="SearchField trống" htmlFor="lab-search-empty" hint="Không hiện nút xóa khi chưa có nội dung.">
                <SearchField id="lab-search-empty" placeholder="Tên, SKU, barcode…" />
              </FormField>
            </div>
          </Card>

          <Card>
            <h2>Form primitives</h2>
            <div className="ui-lab__form-grid">
              <FormField label="Tên hàng" htmlFor="lab-name" required hint="Touch target tối thiểu 44px."><Input id="lab-name" placeholder="Nhập tên hàng" /></FormField>
              <FormField label="Nhóm hàng" htmlFor="lab-group"><Select id="lab-group" defaultValue="noi-that"><option value="noi-that">Nội thất</option><option value="chan-ga">Chăn ga</option></Select></FormField>
              <FormField label="Ghi chú" htmlFor="lab-note"><Textarea id="lab-note" placeholder="Ghi chú" /></FormField>
              <Checkbox label="Đang kinh doanh" defaultChecked />
            </div>
          </Card>

          <Card>
            <h2>Card, Badge & Alert / Status</h2>
            <p>Card giữ vai trò surface trung tính; Badge và Alert dùng màu semantic để phân biệt trạng thái mà không thay đổi hành vi.</p>
            <h3>Badge tones</h3>
            <div className="ui-lab__inline">
              <Badge>Trung tính</Badge>
              <Badge tone="primary">Chính</Badge>
              <Badge tone="success">Còn hàng</Badge>
              <Badge tone="warning">Sắp hết</Badge>
              <Badge tone="danger">Hết hàng</Badge>
              <Badge tone="info">Thông tin</Badge>
            </div>
            <h3>Alert / StatusMessage</h3>
            <div className="ui-lab__stack">
              <StatusMessage tone="success" title="Đã lưu">Thông báo thành công dùng role=status và aria-live polite.</StatusMessage>
              <StatusMessage tone="warning" title="Sắp hết hàng">Còn 2 sản phẩm trong kho, nên cân nhắc nhập thêm.</StatusMessage>
              <StatusMessage tone="info" title="Thông tin">Đây là thông tin hỗ trợ, không chặn thao tác của người dùng.</StatusMessage>
              <StatusMessage tone="danger" title="Có lỗi" announce="assertive">Lỗi quan trọng dùng role=alert và aria-live assertive.</StatusMessage>
            </div>
          </Card>

          <Card>
            <div className="ui-lab__section-head"><h2>Table foundations</h2><SearchField value={query} onChange={(event) => setQuery(event.target.value)} onClear={() => setQuery('')} placeholder="Tìm demo" /></div>
            <h3>ResponsiveDataTable</h3>
            <ResponsiveDataTable columns={columns} rows={rows} rowKey={(row) => row.id} caption="Danh sách hàng demo responsive" empty={<EmptyState title="Không có kết quả" />} />
            <h3>ScrollableDataTable</h3>
            <ScrollableDataTable columns={columns} rows={rows} rowKey={(row) => `scroll-${row.id}`} caption="Danh sách hàng demo cuộn ngang" />
            <h3>CompactList</h3>
            <CompactList rows={rows} rowKey={(row) => `list-${row.id}`} ariaLabel="Danh sách hàng gọn" renderPrimary={(row) => row.name} renderSecondary={(row) => row.sku} renderTrailing={(row) => <Badge tone={row.stock ? 'success' : 'danger'}>{row.stock}</Badge>} />
          </Card>

          <Card>
            <h2>States & Dialog</h2>
            <div className="ui-lab__grid"><EmptyState title="Chưa có dữ liệu">Dùng khi danh sách trống.</EmptyState><LoadingState label="Đang tải dữ liệu mẫu…" /></div>
            <div className="ui-lab__inline"><Button onClick={() => setDialogOpen(true)}>Mở Dialog</Button></div>
          </Card>
        </main>
      </section>

      <Dialog
        open={dialogOpen}
        title="Dialog foundation"
        onClose={() => setDialogOpen(false)}
        initialFocusRef={initialDialogFocusRef}
        savingLock={saving}
        footer={<><Button variant="ghost" disabled={saving} onClick={() => setDialogOpen(false)}>Hủy</Button><Button onClick={() => setSaving((value) => !value)}>{saving ? 'Bỏ saving demo' : 'Bật saving lock'}</Button></>}
      >
        <FormField label="Tên sản phẩm" htmlFor="lab-dialog-name"><Input ref={initialDialogFocusRef} id="lab-dialog-name" defaultValue="Sản phẩm mẫu" /></FormField>
        <p>Thử Escape, Tab, Shift+Tab, scroll lock và restore focus về nút mở.</p>
      </Dialog>
    </div>
  );
}
