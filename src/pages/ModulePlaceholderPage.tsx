export default function ModulePlaceholderPage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Module</p>
          <h1>{title}</h1>
          <p className="muted">{description}</p>
        </div>
      </div>

      <div className="empty-state">
        <strong>Khung điều hướng đã sẵn sàng</strong>
        <p>Chức năng nghiệp vụ của module này sẽ được triển khai ở nhiệm vụ riêng để tránh xung đột code.</p>
      </div>
    </section>
  );
}
