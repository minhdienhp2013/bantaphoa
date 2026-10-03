## Mục tiêu

Mô tả ngắn một mục tiêu duy nhất của PR.

## Pre-code / reuse check

- [ ] Tôi đã đọc các project rules/architecture/schema liên quan.
- [ ] Tôi đã search code tương tự trước khi viết mới.
- [ ] Tôi đã trace luồng dữ liệu/control flow liên quan.
- [ ] Tôi đã reuse/extend implementation hiện có khi phù hợp.
- [ ] Tôi không tạo hệ thống song song cho cùng một trách nhiệm.
- [ ] Tôi không thêm abstraction/file/dependency nếu không thực sự cần.
- [ ] Nếu là bug, tôi sửa root cause thay vì chỉ vá symptom.

## Scope

**Files/module được phép sửa:**

**Files/shared contract cố ý không sửa:**

- [ ] Diff chỉ nằm trong scope hoặc có blocker trực tiếp được giải thích rõ.

## Data / security / architecture

- [ ] Không đổi schema/model/shared contract, hoặc đã có phê duyệt Central rõ ràng.
- [ ] Không đổi Firebase Security Rules/permission, hoặc đã có phê duyệt Central rõ ràng.
- [ ] Không thêm write path nghiệp vụ mới ngoài contract đã duyệt.
- [ ] Không sửa trực tiếp stock ngoài stock operation/CAS contract hiện có.
- [ ] Không phá idempotency/audit/history contract.
- [ ] Đã xem xét race condition và data-loss risk.

## Dependency

- [ ] Không thêm dependency mới.

Nếu có dependency mới, giải thích native/current dependency đã đánh giá, lý do không đủ, và ảnh hưởng bundle/security/maintenance.

## UI/UX nếu có

- [ ] Responsive phù hợp các viewport liên quan.
- [ ] Keyboard/accessibility/focus/touch-target đã được xem xét.
- [ ] Reuse UI pattern/component hiện có nếu phù hợp.

## Validation

- [ ] Regression/contract test cho logic không trivial hoặc bug fix.
- [ ] `npm test` PASS.
- [ ] `npm run build` PASS.
- [ ] CI trên exact head PASS.

## Báo cáo

**Base SHA:**

**Head SHA:**

**Code/pattern reused:**

**Code mới thực sự cần thiết:**

**Known limitations / residual risks:**

**Schema/security/dependency changed:** YES / NO

**Impact tới module khác:**
