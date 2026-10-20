<template>
	<div class="flow-graph">
		<header v-if="title || subtitle" class="graph-header">
			<strong>{{ title }}</strong>
			<p v-if="subtitle" class="muted">{{ subtitle }}</p>
		</header>

		<p v-if="!graph" class="muted">No layout is available for this change.</p>
		<p v-else-if="!panels.length" class="muted">No steps existed at this point.</p>

		<div v-else class="canvas-scroll">
			<div class="canvas" :style="canvasStyle">
				<svg class="edges" :width="canvasWidth" :height="canvasHeight" aria-hidden="true">
					<path
						v-for="edge in edges"
						:key="edge.id"
						:d="edge.path"
						:class="['edge', edge.kind]"
						fill="none"
					/>
				</svg>

				<article
					v-for="panel in panels"
					:key="panel.id"
					class="card"
					:class="{
						trigger: panel.kind === 'trigger',
						highlighted: panel.id === highlightId,
						fallback: panel.positionFallback,
					}"
					:style="cardStyle(panel)"
				>
					<header class="card-header">
						<div class="card-icon" :style="panel.color ? { background: panel.color } : null">
							<v-icon :name="panel.icon || 'extension'" small />
						</div>
						<div class="card-titles">
							<strong>{{ panel.name }}</strong>
							<span>{{ panel.kind === 'trigger' ? 'Trigger' : panel.type }}</span>
						</div>
					</header>

					<details v-if="hasOptions(panel)" class="card-options">
						<summary>Settings</summary>
						<pre>{{ pretty(panel.options) }}</pre>
					</details>
				</article>
			</div>
		</div>
	</div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
	graph: { type: Object, default: null },
	highlightId: { type: String, default: null },
	title: { type: String, default: '' },
	subtitle: { type: String, default: '' },
});

const CELL = 14;
const PANEL = 12;

const panels = computed(() => props.graph?.panels ?? []);

const bounds = computed(() => {
	let maxX = 20;
	let maxY = 20;
	for (const panel of panels.value) {
		maxX = Math.max(maxX, (panel.x || 1) + PANEL + 2);
		maxY = Math.max(maxY, (panel.y || 1) + PANEL + 2);
	}
	return { maxX, maxY };
});

const canvasWidth = computed(() => bounds.value.maxX * CELL);
const canvasHeight = computed(() => bounds.value.maxY * CELL);
const canvasStyle = computed(() => ({
	width: `${canvasWidth.value}px`,
	height: `${canvasHeight.value}px`,
	gridTemplateColumns: `repeat(${bounds.value.maxX}, ${CELL}px)`,
	gridTemplateRows: `repeat(${bounds.value.maxY}, ${CELL}px)`,
}));

const panelById = computed(() => {
	const map = new Map();
	for (const panel of panels.value) map.set(panel.id, panel);
	return map;
});

const edges = computed(() => {
	const result = [];
	for (const panel of panels.value) {
		if (panel.resolve && panelById.value.has(panel.resolve)) {
			result.push(makeEdge(panel, panelById.value.get(panel.resolve), 'resolve'));
		}
		if (panel.reject && panelById.value.has(panel.reject)) {
			result.push(makeEdge(panel, panelById.value.get(panel.reject), 'reject'));
		}
	}
	return result;
});

function cardStyle(panel) {
	return {
		gridColumn: `${panel.x} / span ${PANEL}`,
		gridRow: `${panel.y} / span ${PANEL}`,
	};
}

function makeEdge(from, to, kind) {
	const x1 = ((from.x || 1) + PANEL - 1) * CELL;
	const y1 = ((from.y || 1) + PANEL / 2) * CELL;
	const x2 = (to.x || 1) * CELL;
	const y2 = ((to.y || 1) + PANEL / 2) * CELL;
	const mid = (x1 + x2) / 2;
	return {
		id: `${from.id}:${kind}:${to.id}`,
		kind,
		path: `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`,
	};
}

function hasOptions(panel) {
	return panel.options && Object.keys(panel.options).length > 0;
}

function pretty(value) {
	return JSON.stringify(value, null, 2);
}
</script>

<style scoped>
.flow-graph {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.graph-header p {
	margin: 4px 0 0;
	font-size: 13px;
}

.canvas-scroll {
	overflow: auto;
	border: var(--theme--border-width) solid var(--theme--border-color-subdued);
	border-radius: var(--theme--border-radius);
	background:
		linear-gradient(90deg, color-mix(in srgb, var(--theme--border-color-subdued) 55%, transparent) 1px, transparent 1px),
		linear-gradient(color-mix(in srgb, var(--theme--border-color-subdued) 55%, transparent) 1px, transparent 1px),
		var(--theme--background-subdued);
	background-size: 14px 14px;
	max-height: 560px;
}
.canvas {
	position: relative;
	display: grid;
	min-width: 100%;
	min-height: 280px;
	padding: 8px;
}
.edges {
	position: absolute;
	inset: 8px auto auto 8px;
	pointer-events: none;
	z-index: 1;
}
.edge {
	stroke-width: 2;
}
.edge.resolve {
	stroke: var(--theme--primary);
}
.edge.reject {
	stroke: var(--theme--secondary, var(--theme--warning));
	stroke-dasharray: 5 4;
}
.card {
	position: relative;
	z-index: 2;
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 12px;
	border: var(--theme--border-width) solid var(--theme--border-color-subdued);
	border-radius: var(--theme--border-radius);
	background: var(--theme--background);
	box-shadow: 0 1px 2px color-mix(in srgb, var(--theme--foreground) 8%, transparent);
	overflow: hidden;
}
.card.trigger {
	border-color: var(--theme--primary);
}
.card.highlighted {
	outline: 2px solid var(--theme--primary);
	outline-offset: 2px;
}
.card.fallback {
	border-style: dashed;
}
.card-header {
	display: flex;
	gap: 10px;
	align-items: center;
}
.card-icon {
	width: 32px;
	height: 32px;
	border-radius: 8px;
	display: grid;
	place-items: center;
	background: var(--theme--background-normal);
	color: var(--theme--primary);
	flex-shrink: 0;
}
.card-titles {
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-width: 0;
}
.card-titles strong,
.card-titles span {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.card-titles span {
	color: var(--theme--foreground-subdued);
	font-size: 12px;
}
.card-options summary {
	cursor: pointer;
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}
.card-options pre {
	margin: 6px 0 0;
	max-height: 90px;
	overflow: auto;
	font-size: 11px;
	background: var(--theme--background-subdued);
	padding: 8px;
	border-radius: var(--theme--border-radius);
}
.muted {
	color: var(--theme--foreground-subdued);
}
</style>
