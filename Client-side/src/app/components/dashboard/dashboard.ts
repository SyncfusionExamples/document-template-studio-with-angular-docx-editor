import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';

import { Tpl } from '../../data/sample-templates';

const TYPE_COLORS: Record<string, string> = {
  Invoice: '#d6336c',
  ThankYou: '#2b8a3e',
  TaxReceipt: '#1971c2',
  General: '#5c3eb1',
};

@Component({
  selector: 'app-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class DashboardComponent {
  @Input() templates: Tpl[] = [];
  @Input() isUploading = false;
  @Output() open = new EventEmitter<string>();
  @Output() add = new EventEmitter<void>();
  @Output() upload = new EventEmitter<void>();
  @Output() delete = new EventEmitter<string>();

  protected readonly colors = TYPE_COLORS;

  onCardKey(ev: KeyboardEvent, id: string) {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      this.open.emit(id);
    }
  }

  onDelete(ev: Event, id: string) {
    ev.stopPropagation();
    ev.preventDefault();
    this.delete.emit(id);
  }
}