import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  signal,
  computed,
  ElementRef,
  ViewChild,
  AfterViewInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { ButtonModule } from '@syncfusion/ej2-angular-buttons';

import { Tpl, MERGE_FIELDS } from '../../data/sample-templates';
import {
  addCustomMergeField,
  AddCustomMergeFieldResult,
} from '../../utils/studio-storage';

export const MERGE_FIELD_MIME = 'application/x-ts-mergefield';
export const MERGE_FIELD_PAYLOAD_MIME = 'application/json';

interface FieldDescriptor {
  key: string;
}

function listFields(
  fieldKeys: string[] | undefined,
  customMap: Record<string, unknown> | undefined,
  commonFieldsProp: Record<string, unknown> | undefined,
  documentMergeFields: string[] | undefined,
): FieldDescriptor[] {
  const out: FieldDescriptor[] = [];
  const seen = new Set<string>();
  const push = (k: string) => {
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ key: k });
  };
  for (const k of fieldKeys || []) push(k);
  for (const k of Object.keys(commonFieldsProp || {})) push(k);
  for (const k of documentMergeFields || []) {
    if (!k) continue;
    push(k);
  }
  return out;
}

function buildDragGhost(key: string): HTMLElement {
  const ghost = document.createElement('div');
  ghost.className = 'ts-drag-ghost';
  ghost.style.position = 'fixed';
  ghost.style.top = '-9999px';
  ghost.style.left = '-9999px';
  ghost.style.zIndex = '2147483647';
  const label = document.createElement('span');
  label.className = 'ts-drag-ghost-label';
  label.textContent = `\u00ab ${key} \u00bb`;
  ghost.appendChild(label);
  document.body.appendChild(ghost);
  return ghost;
}

@Component({
  selector: 'app-merge-fields-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, ButtonModule],
  templateUrl: './merge-fields-panel.html',
  styleUrl: './merge-fields-panel.css',
})
export class MergeFieldsPanelComponent implements AfterViewInit, OnDestroy {
  @Input() template: Tpl | null = null;
  @Input() customFieldMap: Record<string, unknown> = {};
  @Input() commonFieldsProp: Record<string, unknown> = {};
  @Input() documentMergeFields: string[] = [];
  @Output() insertField = new EventEmitter<string>();
  @Output() customFieldAdded = new EventEmitter<{
    scope: 'template' | 'common';
    key: string;
    field: unknown;
    fieldKeys?: string[] | null;
    templateId: string | null;
  }>();

  @ViewChild('keyInput') keyInput?: ElementRef<HTMLInputElement>;

  showAdd = signal(false);
  scope = signal<'template' | 'common'>('template');
  key = signal('');
  saving = signal(false);
  error = signal('');

  // re-export MERGE_FIELDS for template usage
  protected readonly MERGE_FIELDS = MERGE_FIELDS;

  fields = computed<FieldDescriptor[]>(() =>
    this.template
      ? listFields(
          this.template.fieldKeys,
          this.customFieldMap,
          this.commonFieldsProp,
          this.documentMergeFields,
        )
      : [],
  );

  constructor(private cdr: ChangeDetectorRef) {}

  ngAfterViewInit(): void {
    // focus is handled via setFocusIfOpen when panel opens
  }

  ngOnDestroy(): void {
    // no-op: any drag ghost is cleaned in handleChipDragEnd
  }

  openAdd() {
    this.showAdd.set(true);
    this.scope.set(this.template ? 'template' : 'common');
    this.key.set('');
    this.error.set('');
    // focus the input on next tick
    setTimeout(() => this.keyInput?.nativeElement.focus(), 30);
  }

  closeAdd() {
    if (this.saving()) return;
    this.showAdd.set(false);
    this.error.set('');
  }

  onScopeChange(value: 'template' | 'common') {
    this.scope.set(value);
  }

  onKeyChange(value: string) {
    this.key.set(value || '');
  }

  validate(): string {
    const k = this.key().trim();
    if (!k) return 'Field Name is required.';
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(k)) {
      return 'Field Name must start with a letter and contain only letters/digits.';
    }
    return '';
  }

  async handleSubmit(ev?: Event) {
    ev?.preventDefault();
    const v = this.validate();
    if (v) {
      this.error.set(v);
      return;
    }
    this.error.set('');
    this.saving.set(true);
    this.cdr.markForCheck();
    try {
      const scope = this.scope();
      const tpl = this.template;
      const result: AddCustomMergeFieldResult = await addCustomMergeField({
        scope,
        templateId: scope === 'template' ? tpl?.id : undefined,
        templateName: tpl?.name,
        templateType: tpl?.type,
        templateDescription: tpl?.description,
        key: this.key().trim(),
      });
      this.customFieldAdded.emit({
        scope,
        templateId: scope === 'template' ? (tpl?.id ?? null) : null,
        key: result.key,
        field: result.field,
        fieldKeys: result.fieldKeys ?? null,
      });
      this.showAdd.set(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);
      this.error.set(message);
    } finally {
      this.saving.set(false);
      this.cdr.markForCheck();
    }
  }

  // Drag-and-drop handlers for chips
  handleChipDragStart(ev: DragEvent, k: string) {
    if (!ev || !ev.dataTransfer) return;
    try {
      ev.dataTransfer.setData(MERGE_FIELD_MIME, k);
      ev.dataTransfer.setData('text/plain', k);
      ev.dataTransfer.setData(
        MERGE_FIELD_PAYLOAD_MIME,
        JSON.stringify({ source: 'merge-fields-panel', key: k }),
      );
      ev.dataTransfer.effectAllowed = 'copy';
      const ghost = buildDragGhost(k);
      try {
        ev.dataTransfer.setDragImage(
          ghost,
          ghost.offsetWidth / 2,
          ghost.offsetHeight / 2,
        );
      } catch {
        /* some browsers throw on setDragImage outside an active drag */
      }
      (ev.currentTarget as HTMLElement & { __tsDragGhost?: HTMLElement }).__tsDragGhost = ghost;
    } catch {
      /* dataTransfer not writeable for some reason */
    }
  }

  handleChipDragEnd(ev: DragEvent) {
    const curr = ev.currentTarget as HTMLElement & {
      __tsDragGhost?: HTMLElement | null;
    };
    const ghost = curr && curr.__tsDragGhost;
    if (ghost && ghost.parentNode) {
      ghost.parentNode.removeChild(ghost);
    }
    if (curr) curr.__tsDragGhost = null;
  }

  handleOverlayClick(ev: MouseEvent) {
    if (ev.target === ev.currentTarget && !this.saving()) {
      this.closeAdd();
    }
  }
}