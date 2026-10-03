import type { ReactNode } from 'react';

export interface DataColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  mobileLabel?: ReactNode;
}

interface DataTableProps<T> {
  columns: readonly DataColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T, index: number) => string;
  caption?: string;
  empty?: ReactNode;
}

function TableCore<T>({ columns, rows, rowKey, caption }: Omit<DataTableProps<T>, 'empty'>) {
  return (
    <table className="ui-data-table">
      {caption ? <caption className="ui-sr-only">{caption}</caption> : null}
      <thead>
        <tr>{columns.map((column) => <th key={column.key} scope="col">{column.header}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={rowKey(row, index)}>
            {columns.map((column) => <td key={column.key}>{column.render(row)}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ScrollableDataTable<T>(props: DataTableProps<T>) {
  if (props.rows.length === 0 && props.empty) return <>{props.empty}</>;
  return <div className="ui-table-scroll"><TableCore {...props} /></div>;
}

export function ResponsiveDataTable<T>(props: DataTableProps<T>) {
  if (props.rows.length === 0 && props.empty) return <>{props.empty}</>;
  return (
    <div className="ui-responsive-table">
      <div className="ui-table-scroll"><TableCore {...props} /></div>
      <div className="ui-responsive-table__cards">
        {props.rows.map((row, index) => (
          <article className="ui-responsive-table__card" key={props.rowKey(row, index)}>
            {props.columns.map((column) => (
              <div className="ui-responsive-table__field" key={column.key}>
                <span className="ui-responsive-table__label">{column.mobileLabel ?? column.header}</span>
                <span>{column.render(row)}</span>
              </div>
            ))}
          </article>
        ))}
      </div>
    </div>
  );
}

interface CompactListProps<T> {
  rows: readonly T[];
  rowKey: (row: T, index: number) => string;
  renderPrimary: (row: T) => ReactNode;
  renderSecondary?: (row: T) => ReactNode;
  renderTrailing?: (row: T) => ReactNode;
  ariaLabel: string;
  empty?: ReactNode;
}

export function CompactList<T>({ rows, rowKey, renderPrimary, renderSecondary, renderTrailing, ariaLabel, empty }: CompactListProps<T>) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <ul className="ui-compact-list" aria-label={ariaLabel}>
      {rows.map((row, index) => (
        <li className="ui-compact-list__item" key={rowKey(row, index)}>
          <div>
            <strong>{renderPrimary(row)}</strong>
            {renderSecondary ? <div className="ui-compact-list__secondary">{renderSecondary(row)}</div> : null}
          </div>
          {renderTrailing ? <div>{renderTrailing(row)}</div> : null}
        </li>
      ))}
    </ul>
  );
}
