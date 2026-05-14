import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { BaseChartDirective } from 'ng2-charts';
import { Chart, ChartData, ChartOptions } from 'chart.js';
import DataLabelsPlugin from 'chartjs-plugin-datalabels';

import { PublisherRecord, SupabaseService } from '../../services/supabase.service';
import { ToastService } from '../../services/toast.service';
import { ServiceYearSelectorComponent } from '../service-year-selector/service-year-selector.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, ServiceYearSelectorComponent, BaseChartDirective],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent implements OnInit {
  protected recordsLoading = false;
  protected yearRecords: PublisherRecord[] = [];

  constructor(
    protected readonly supabase: SupabaseService,
    private readonly router: Router,
    private readonly toast: ToastService,
    private readonly cdr: ChangeDetectorRef
  ) {
    Chart.register(DataLabelsPlugin);
  }

  async ngOnInit(): Promise<void> {
    await this.loadRecordsForYear();
  }

  protected async onYearChanged(): Promise<void> {
    await this.loadRecordsForYear();
  }

  protected get totalPublishers(): number {
    return this.yearRecords.filter((r) => !r.inactive).length;
  }

  protected get regularPioneerCount(): number {
    return this.yearRecords.filter((r) => r.regular_pioneer).length;
  }

  protected get auxiliaryPioneerCount(): number {
    return this.yearRecords.filter((r) =>
      r.months?.some((m) => m.auxiliaryPioneer)
    ).length;
  }

  protected get elderCount(): number {
    return this.yearRecords.filter((r) => r.elder).length;
  }

  protected get ministerialServantCount(): number {
    return this.yearRecords.filter((r) => r.ministerial_servant).length;
  }

  protected get unbaptizedPublisherCount(): number {
    return this.yearRecords.filter((r) => r.unbaptized_publisher).length;
  }

  protected get inactivePublisherCount(): number {
    return this.yearRecords.filter((r) => !!r.inactive).length;
  }

  protected searchQuery = '';

  protected get donutChartData(): ChartData<'doughnut'> {
    return {
      labels: ['Elders', 'Ministerial Servants', 'Regular Pioneers', 'Auxiliary Pioneers', 'Unbaptized Publishers', 'Other Active'],
      datasets: [{
        data: [
          this.elderCount,
          this.ministerialServantCount,
          this.regularPioneerCount,
          this.auxiliaryPioneerCount,
          this.unbaptizedPublisherCount,
          Math.max(0, this.totalPublishers - this.elderCount - this.ministerialServantCount - this.regularPioneerCount - this.auxiliaryPioneerCount - this.unbaptizedPublisherCount),
        ],
        backgroundColor: ['#6366f1', '#818cf8', '#a5b4fc', '#c7d7fe', '#e0e9ff', '#e5e7eb'],
        borderWidth: 2,
        borderColor: '#fff',
        hoverOffset: 6,
      }],
    };
  }

  protected get centerTextPlugin() {
    const total = this.totalPublishers;
    return {
      id: 'centerText',
      afterDatasetsDraw: (chart: Chart) => {
        const { ctx, chartArea: { left, top, right, bottom } } = chart;
        const cx = (left + right) / 2;
        const cy = (top + bottom) / 2;
        ctx.save();

        // Icon
        ctx.font = '22px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('👥', cx, cy - 22);

        // Count
        ctx.font = 'bold 30px Poppins, sans-serif';
        ctx.fillStyle = '#374151';
        ctx.fillText(String(total), cx, cy + 6);

        // Sub-label
        ctx.font = '12px Poppins, sans-serif';
        ctx.fillStyle = '#9ca3af';
        ctx.fillText('Active', cx, cy + 28);

        ctx.restore();
      },
    };
  }

  protected readonly connectorLinesPlugin = {
    id: 'doughnutConnectors',
    afterDatasetsDraw: (chart: Chart) => {
      const { ctx } = chart;
      chart.data.datasets.forEach((_: unknown, i: number) => {
        const meta = chart.getDatasetMeta(i);
        (meta.data as any[]).forEach((arc, j) => {
          const value = chart.data.datasets[i].data[j] as number;
          if (!value) return;
          const { startAngle, endAngle, outerRadius, x, y } = arc;
          const midAngle = (startAngle + endAngle) / 2;
          const cos = Math.cos(midAngle);
          const sin = Math.sin(midAngle);
          const x1 = x + cos * outerRadius;
          const y1 = y + sin * outerRadius;
          const x2 = x + cos * (outerRadius + 16);
          const y2 = y + sin * (outerRadius + 16);
          const bgColors = (chart.data.datasets[i] as any).backgroundColor;
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.strokeStyle = bgColors[j];
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        });
      });
    },
  };

  protected readonly donutChartOptions: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '65%',
    layout: { padding: { top: 48, bottom: 48, left: 72, right: 72 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        enabled: true,
        callbacks: {
          title: (items) => items[0]?.label ?? '',
          label: (ctx) => {
            const descriptions: Record<string, string> = {
              'Elders': ' Appointed overseers of the congregation',
              'Ministerial Servants': ' Appointed ministerial servants',
              'Regular Pioneers': ' Publishers with regular pioneer status',
              'Auxiliary Pioneers': ' Publishers who auxiliary pioneered this year',
              'Unbaptized Publishers': ' Publishers not yet baptized',
              'Other Active': ' Active publishers with no specific privilege',
            };
            const label = ctx.label ?? '';
            const desc = descriptions[label] ?? '';
            return ` ${ctx.parsed} publishers —${desc}`;
          },
        },
        padding: 12,
        boxPadding: 6,
        titleFont: { size: 13, weight: 'bold', family: 'Poppins' },
        bodyFont: { size: 12, family: 'Poppins' },
        backgroundColor: '#1f2937',
        titleColor: '#f9fafb',
        bodyColor: '#d1d5db',
        cornerRadius: 8,
      },
      datalabels: {
        display: (ctx) => (ctx.dataset.data[ctx.dataIndex] as number) > 0,
        anchor: 'end',
        align: 'end',
        offset: 20,
        formatter: (value, ctx) => {
          const label = ctx.chart.data.labels?.[ctx.dataIndex] ?? '';
          return `${label}: ${value}`;
        },
        color: '#374151',
        font: { size: 11, family: 'Poppins', weight: 'bold' },
        textAlign: 'center',
      },
    } as ChartOptions<'doughnut'>['plugins'],
  };

  protected async onEldersCardClick(): Promise<void> {
    await this.router.navigate(['/publishers-record/search-records'], {
      queryParams: { privilege: 'elder' },
    });
  }

  protected async onRegularPioneersCardClick(): Promise<void> {
    await this.router.navigate(['/publishers-record/search-records'], {
      queryParams: { privilege: 'regular-pioneer' },
    });
  }

  protected async onTotalPublishersCardClick(): Promise<void> {
    await this.router.navigate(['/publishers-record/search-records'], {
      queryParams: { privilege: 'all' },
    });
  }

  protected async onAuxiliaryPioneersCardClick(): Promise<void> {
    await this.router.navigate(['/publishers-record/search-records'], {
      queryParams: { privilege: 'auxiliary-pioneer' },
    });
  }

  protected async onMinisterialServantsCardClick(): Promise<void> {
    await this.router.navigate(['/publishers-record/search-records'], {
      queryParams: { privilege: 'ministerial-servant' },
    });
  }

  protected async onUnbaptizedPublishersCardClick(): Promise<void> {
    await this.router.navigate(['/publishers-record/search-records'], {
      queryParams: { privilege: 'unbaptized-publisher' },
    });
  }

  protected async onInactivePublishersCardClick(): Promise<void> {
    await this.router.navigate(['/publishers-record/search-records'], {
      queryParams: { privilege: 'inactive' },
    });
  }

  protected async onDashboardSearch(): Promise<void> {
    const text = this.searchQuery.trim();
    if (!text) return;
    await this.router.navigate(['/publishers-record/search-records'], { queryParams: { q: text } });
  }

  protected onClearSearch(): void {
    this.searchQuery = '';
  }

  private async loadRecordsForYear(): Promise<void> {
    this.recordsLoading = true;
    this.cdr.detectChanges();

    try {
      this.yearRecords = await this.supabase.getPublisherRecordsByServiceYear(
        this.supabase.serviceYear()
      );
    } catch (err) {
      this.toast.showError(
        err instanceof Error ? err.message : 'Failed to load service year records.'
      );
    } finally {
      this.recordsLoading = false;
      this.cdr.detectChanges();
    }
  }
}
