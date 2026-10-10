import type { Person } from '../../../src/types';
export function Topbar({
  operator,
  current,
  people,
  onSelectPerson,
}: {
  operator: boolean;
  current: Person | null;
  people: Person[];
  onSelectPerson: (id: string) => void;
}) {
  return (
    <header className="topbar">
      <div className="breadcrumb">
        Banana Bank <span>/</span> {operator ? 'Customer support' : 'Personal banking'}
      </div>
      <div className="persona-control">
        <span className="demo-label">VIEW AS</span>
        <span className="avatar small" style={{ background: current?.color }}>
          {current?.initials || '·'}
        </span>
        <select
          aria-label="Switch person"
          value={current?.id || ''}
          disabled={!current}
          onChange={(e) => onSelectPerson(e.target.value)}
        >
          <option value="" disabled>
            Loading…
          </option>
          <optgroup label="Customers">
            {people
              .filter((p) => p.role === 'customer')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </optgroup>
          <optgroup label="Operators">
            {people
              .filter((p) => p.role === 'operator')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · Operator
                </option>
              ))}
          </optgroup>
        </select>
      </div>
    </header>
  );
}
