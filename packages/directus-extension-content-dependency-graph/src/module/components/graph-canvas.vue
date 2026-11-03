<template>
	<div class="graph-canvas">
		<div class="toolbar">
			<v-button v-tooltip="'Zoom in'" icon x-small secondary @click="zoomBy(1.25)">
				<v-icon name="add" small />
			</v-button>
			<v-button v-tooltip="'Zoom out'" icon x-small secondary @click="zoomBy(0.8)">
				<v-icon name="remove" small />
			</v-button>
			<v-button v-tooltip="'Fit to screen'" icon x-small secondary @click="fit">
				<v-icon name="fit_screen" small />
			</v-button>
		</div>

		<svg
			ref="svgRef"
			class="canvas"
			:class="{ panning: drag }"
			role="img"
			aria-label="Collection links"
			@wheel.prevent="onWheel"
			@pointerdown="onPointerDown"
			@pointermove="onPointerMove"
			@pointerup="onPointerUp"
			@pointercancel="onPointerUp"
		>
			<defs>
				<marker
					v-for="state in ['idle', 'active']"
					:id="`cdg-arrow-${state}`"
					:key="state"
					viewBox="0 0 10 10"
					refX="9"
					refY="5"
					markerWidth="7"
					markerHeight="7"
					orient="auto-start-reverse"
				>
					<path d="M 0 0 L 10 5 L 0 10 z" class="arrow" :class="state" />
				</marker>
			</defs>

			<g :transform="`translate(${view.x} ${view.y}) scale(${view.k})`">
				<path
					v-for="edge in layout.edges"
					:key="edge.id"
					:d="edge.path"
					class="edge"
					:class="edgeState(edge)"
					:marker-end="`url(#cdg-arrow-${isActive(edge) ? 'active' : 'idle'})`"
				>
					<title>{{ technicalLabel(edge) }}</title>
				</path>

				<text
					v-for="edge in labelledEdges"
					:key="`label-${edge.id}`"
					:x="edge.labelX"
					:y="edge.labelY"
					class="edge-label"
					text-anchor="middle"
					dominant-baseline="middle"
				>
					{{ humanize(edge.field) }}
				</text>

				<g
					v-for="node in layout.nodes"
					:key="node.id"
					class="node"
					:class="{ system: node.system, selected: node.id === selected, dimmed: isDimmed(node.id) }"
					:transform="`translate(${node.x} ${node.y})`"
					data-node
					@click.stop="emit('select', node.id)"
				>
					<rect :width="node.width" :height="node.height" rx="6" />
					<text :x="node.width / 2" :y="node.height / 2" text-anchor="middle" dominant-baseline="central">
						{{ node.label }}
					</text>
					<title>{{ node.id }}</title>
				</g>
			</g>
		</svg>
	</div>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { humanize, technicalLabel } from '../../shared/wording.js';

const props = defineProps({
	layout: { type: Object, required: true },
	selected: { type: String, default: null },
});

const emit = defineEmits(['select']);

const svgRef = ref(null);
const view = reactive({ x: 0, y: 0, k: 1 });
const drag = ref(null);

const connected = computed(() => {
	if (!props.selected) return null;
	const ids = new Set([props.selected]);
	for (const edge of props.layout.edges) {
		if (edge.source === props.selected) ids.add(edge.target);
		if (edge.target === props.selected) ids.add(edge.source);
	}
	return ids;
});

const labelledEdges = computed(() => props.layout.edges.filter(isActive));

function isActive(edge) {
	return Boolean(props.selected) && (edge.source === props.selected || edge.target === props.selected);
}

function edgeState(edge) {
	if (!props.selected) return null;
	return isActive(edge) ? 'active' : 'dimmed';
}

function isDimmed(id) {
	return connected.value ? !connected.value.has(id) : false;
}

function size() {
	const rect = svgRef.value?.getBoundingClientRect();
	return { width: rect?.width || 800, height: rect?.height || 600 };
}

function fit() {
	const { width, height } = size();
	const k = Math.min((width - 40) / props.layout.width, (height - 40) / props.layout.height, 1.25);
	view.k = Math.max(0.05, k);
	view.x = (width - props.layout.width * view.k) / 2;
	view.y = (height - props.layout.height * view.k) / 2;
}

function zoomAt(factor, cx, cy) {
	const k = Math.min(4, Math.max(0.05, view.k * factor));
	view.x = cx - ((cx - view.x) / view.k) * k;
	view.y = cy - ((cy - view.y) / view.k) * k;
	view.k = k;
}

function zoomBy(factor) {
	const { width, height } = size();
	zoomAt(factor, width / 2, height / 2);
}

function onWheel(event) {
	const rect = svgRef.value.getBoundingClientRect();
	zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
}

function onPointerDown(event) {
	if (event.button !== 0 || event.target.closest?.('[data-node]')) return;
	drag.value = { startX: event.clientX, startY: event.clientY, x: view.x, y: view.y };
	svgRef.value.setPointerCapture?.(event.pointerId);
}

function onPointerMove(event) {
	if (!drag.value) return;
	view.x = drag.value.x + event.clientX - drag.value.startX;
	view.y = drag.value.y + event.clientY - drag.value.startY;
}

function onPointerUp(event) {
	if (!drag.value) return;
	svgRef.value.releasePointerCapture?.(event.pointerId);
	drag.value = null;
}

watch(
	() => props.layout,
	() => nextTick(fit),
);

onMounted(() => nextTick(fit));
</script>

<style scoped>
.graph-canvas {
	position: relative;
	height: 100%;
}

.toolbar {
	position: absolute;
	top: 8px;
	right: 8px;
	display: flex;
	gap: 4px;
	z-index: 1;
}

.canvas {
	display: block;
	width: 100%;
	height: 100%;
	cursor: grab;
	touch-action: none;
	user-select: none;
	font-family: var(--theme--fonts--monospace--font-family), monospace;
}

.canvas.panning { cursor: grabbing; }

.edge {
	fill: none;
	stroke: var(--theme--foreground-subdued);
	stroke-width: 1.5;
	transition: opacity 0.15s;
}

.edge.active { stroke: var(--theme--primary); stroke-width: 2.5; }
.edge.dimmed { opacity: 0.15; }

.arrow.idle { fill: var(--theme--foreground-subdued); }
.arrow.active { fill: var(--theme--primary); }

.edge-label {
	font-size: 10px;
	fill: var(--theme--foreground-subdued);
	stroke: var(--theme--background);
	stroke-width: 4px;
	paint-order: stroke;
	pointer-events: none;
}

.node {
	cursor: pointer;
	transition: opacity 0.15s;
}

.node rect {
	fill: var(--theme--background);
	stroke: var(--theme--border-color);
	stroke-width: 1;
}

.node text {
	font-size: 12px;
	fill: var(--theme--foreground);
	pointer-events: none;
}

.node.system rect { fill: var(--theme--background-normal); }
.node.system text { font-style: italic; fill: var(--theme--foreground-subdued); }
.node:hover rect { stroke: var(--theme--primary); }
.node.selected rect { stroke: var(--theme--primary); stroke-width: 2.5; }
.node.dimmed { opacity: 0.3; }
</style>
