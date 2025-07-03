import { Plugin } from 'obsidian';

import {generatePlottingOptions, plotCurveOptions} from 'libestrannaise/plotting'
import {modelList} from 'libestrannaise/models'
import * as Plot from '@observablehq/plot';

interface EstrannaiseEntry {
	date: Date;
	mg: number;
	model: string;
}

function parseDateFlexible(dateStr: string): Date | null {
	let parts: string[];
	let y: number, m: number, d: number;
	if (dateStr.includes('/')) {
		// m/d/y
		parts = dateStr.split('/').map(s => s.trim());
		if (parts.length !== 3) return null;
		[m, d, y] = parts.map(Number);
	} else if (dateStr.includes('.')) {
		// d.m.y
		parts = dateStr.split('.').map(s => s.trim());
		if (parts.length !== 3) return null;
		[d, m, y] = parts.map(Number);
	} else if (dateStr.includes('-')) {
		// y-m-d
		parts = dateStr.split('-').map(s => s.trim());
		if (parts.length !== 3) return null;
		[y, m, d] = parts.map(Number);
	} else
		return null;

	if ([y, m, d].some(n => isNaN(n))) return null;
	const date = new Date(y, m - 1, d);
	return isNaN(date.getTime()) ? null : date;
}

function parseEstrannaiseCodeblock(codeblock: HTMLElement): EstrannaiseEntry[] | null {
	const text = codeblock.innerText.trim();
	const entries: EstrannaiseEntry[] = [];

	for (const line of text.split("\n")) {
		// eslint-disable-next-line prefer-const
		let [dateStr, mgStr, model] = line.split("|").map(s => s.trim());
		if (!dateStr || !mgStr || !model) return null;

		const modelLower = model.toLowerCase();
		const matchedModel = Object.entries(modelList).find(
			([m, desc]) =>
				m.toLowerCase().includes(modelLower) ||
				(desc && desc.description && desc.description.toLowerCase().includes(modelLower))
		);

		if (!matchedModel) return null;
		const [modelName] = matchedModel;
		model = modelName;

		const date = parseDateFlexible(dateStr);
		const mg = parseFloat(mgStr);

		if (!date || isNaN(date.getTime()) || isNaN(mg))
			return null;

		entries.push({ date, mg, model });
	}

	return entries;
}

interface EstrannaiseDataset {
	customdoses: {
		entries: {
			dose: number;
			time: number;
			model: string;
		}[];
		curveVisible?: boolean;
		uncertaintyVisible?: boolean;
		daysAsIntervals?: boolean;
	};
	steadystates: {
		entries: unknown[];
	};
}

function buildEstrannaiseDataset(datapoints: EstrannaiseEntry[]): EstrannaiseDataset | null {
	if (datapoints.length === 0) {
		return null;
	}

	const baseDate = Date.now();
	const entries = datapoints.map(entry => ({
		dose: entry.mg,
		time: (entry.date.getTime() - baseDate) / (1000 * 60 * 60 * 24),
		model: entry.model
	}));

	return {
		customdoses: {
			entries,
			curveVisible: true,
			uncertaintyVisible: true,
			daysAsIntervals: false
		},
		steadystates: { entries: [] }
	};
}

function remap(v:number, l1:number, h1:number, l2:number, h2:number):number {
    return l2 + (h2 - l2) * (v - l1) / (h1 - l1);
}

function appendPlotWithTitle(parent: HTMLElement, titleText: string, plot: HTMLElement) {
	const title = document.createElement('div');
	title.textContent = titleText;
	title.classList.add('estrannaise-plot-title');
	parent.appendChild(title);
	parent.appendChild(plot);
}

export default class Estrannaise extends Plugin {
	async onload() {
		this.registerMarkdownPostProcessor((element) => {
			const codeblocks = element.querySelectorAll('code.language-estrannaise');
			codeblocks.forEach(codeblock => {
				const entries = parseEstrannaiseCodeblock(codeblock as HTMLElement);
				if(!entries)
				{
					(codeblock as HTMLElement).innerText = "Errornous input";
					return;
				}

				const dataset = buildEstrannaiseDataset(entries);
				if(dataset && dataset.customdoses.entries.length > 0)
				{
					// clear the text out, the graph represents it better.
					(codeblock as HTMLElement).innerText = "";
				}
				else
				{
					(codeblock as HTMLElement).innerText = "Errornous input";
					return;
				}
			
				const options = generatePlottingOptions();
				const plot_options = plotCurveOptions(dataset, options);

				const dosage_highlights = Plot.ruleX(dataset.customdoses.entries.filter((el, i) => i != 0), { x: "time", stroke: "#f7a8B890", strokeWidth: 3, y1: 10, y2: 50 });
				
				// @ts-expect-error: yes, this is very much assignable
				plot_options.marks = [dosage_highlights].concat(plot_options.marks);

				appendPlotWithTitle(
					codeblock.parentElement as HTMLElement,
					`Overview (${dataset.customdoses.entries.length} doses)`,
					Plot.plot(plot_options) as HTMLElement
				);

				// if we're focussing less than 30% of the plot on the last 50 days
				// split up into two plots
				const splitp = Math.max(plot_options.xMin, plot_options.xMax - 50);
				if(remap(splitp, plot_options.xMin, plot_options.xMax, 0.0, 1.0) > 0.7)
				{
					// @ts-expect-error: capMin is either null or number
					options.capMin = splitp;
					const focussed_plot_options = plotCurveOptions(dataset, options);
					// @ts-expect-error: yes, this is very much assignable
					focussed_plot_options.marks = [dosage_highlights].concat(focussed_plot_options.marks);
					
					appendPlotWithTitle(
						codeblock.parentElement as HTMLElement,
						`Last ${Math.floor(plot_options.xMax - splitp)} Days (Zoomed In)`,
						Plot.plot(focussed_plot_options) as HTMLElement
					);
				}
			});
		});
	}
}
