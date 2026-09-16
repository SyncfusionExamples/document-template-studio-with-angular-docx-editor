import {
  Component,
  EventEmitter,
  Output,
  ChangeDetectionStrategy,
  signal,
  computed,
  input,
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { Tpl } from '../../data/sample-templates';

const TYPE_COLORS: Record<string, string> = {
  Invoice: '#d6336c',
  ThankYou: '#2b8a3e',
  TaxReceipt: '#1971c2',
  General: '#5c3eb1',
};

const TYPE_LABELS: Record<string, string> = {
  Invoice: 'INVOICE',
  ThankYou: 'THANK YOU',
  TaxReceipt: 'TAX RECEIPT',
  General: 'GENERAL',
};

interface Group {
  key: string;
  label: string;
  color: string;
  items: Tpl[];
}

function groupTemplates(list: Tpl[]): Group[] {
  const order = ['General', 'ThankYou', 'TaxReceipt', 'Invoice'];
  const known = new Set(order);
  const groups: Group[] = [];
  const seen = new Set<string>();
  const add = (key: string, label: string, color: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    groups.push({ key, label, color, items: [] });
  };
  for (const k of order) add(k, TYPE_LABELS[k] || k, TYPE_COLORS[k] || '#5c3eb1');

  const customKeys = new Set<string>();
  for (const t of list) {
    const k = t.type || '';
    if (k && !known.has(k)) customKeys.add(k);
  }
  Array.from(customKeys)
    .sort()
    .forEach((k) => add(k, k, '#5c3eb1'));

  for (const t of list) {
    const key = t.type || '';
    if (!key) continue;
    const g = groups.find((gr) => gr.key === key);
    if (g) g.items.push(t);
  }
  return groups.filter((g) => g.items.length > 0);
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
})
export class SidebarComponent {
  templates = input<Tpl[]>([]);
  selectedId = input<string | null>(null);
  isUploading = input(false);

  @Output() select = new EventEmitter<string>();
  @Output() add = new EventEmitter<void>();
  @Output() upload = new EventEmitter<void>();
  @Output() delete = new EventEmitter<string>();

  query = signal('');

  protected filtered = computed<Tpl[]>(() => {
    const q = this.query().trim().toLowerCase();
    const list = this.templates();
    if (!q) return list;
    return list.filter(
      (t) =>
        (t.name || '').toLowerCase().includes(q) ||
        (t.type || '').toLowerCase().includes(q),
    );
  });

  protected groups(): Group[] {
    return groupTemplates(this.filtered());
  }

  colorFor(key: string): string {
    return TYPE_COLORS[key] || '#5c3eb1';
  }

  onSearchInput(value: string) {
    this.query.set(value || '');
  }

  trackByGroup = (_: number, g: Group) => g.key;
  trackByTpl = (_: number, t: Tpl) => t.id;

  onRowClick(id: string) {
    this.select.emit(id);
  }

  onRowKey(ev: KeyboardEvent, id: string) {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      this.select.emit(id);
    }
  }

  onDelete(ev: Event, id: string) {
    ev.stopPropagation();
    ev.preventDefault();
    this.delete.emit(id);
  }
}
