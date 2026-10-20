<template>
	<private-view title="Content Dependency Graph">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="account_tree" />
			</v-button>
		</template>

		<template #navigation>
			<div class="nav">
				<v-input v-model="navSearch" small placeholder="Find a collection">
					<template #prepend><v-icon name="search" small /></template>
				</v-input>

				<v-list nav class="nav-list">
					<v-list-item
						v-for="node in navCollections"
						:key="node.id"
						clickable
						:active="view !== 'health' && node.id === selected"
						@click="select(node.id)"
					>
						<v-list-item-icon><v-icon :name="collectionIcon(node.id)" small /></v-list-item-icon>
						<v-list-item-content>
							<span class="nav-name">{{ collectionName(node.id) }}</span>
						</v-list-item-content>
						<span v-tooltip="`${degree.get(node.id) ?? 0} link(s)`" class="nav-count">{{ degree.get(node.id) ?? 0 }}</span>
					</v-list-item>
				</v-list>
				<p v-if="graph && navCollections.length === 0" class="muted small nav-empty">No collections match.</p>

				<v-checkbox v-model="includeSystem" class="nav-system" label="Show system collections" />
			</div>
		</template>

		<template #actions>
			<template v-if="graph">
				<v-button small :secondary="view !== 'map'" @click="toggleView('map')">
					<v-icon :name="view === 'map' ? 'list' : 'hub'" left small /> {{ view === 'map' ? 'Back to details' : 'Show full map' }}
				</v-button>
				<v-button small :secondary="view !== 'health'" @click="toggleView('health')">
					<v-icon name="health_and_safety" left small /> Health check
				</v-button>
				<v-menu show-arrow placement="bottom-end">
					<template #activator="{ toggle }">
						<v-button small secondary @click="toggle">
							<v-icon name="download" left small /> Export
						</v-button>
					</template>
					<v-list>
						<v-list-item v-for="format in EXPORTS" :key="format.id" clickable @click="exportAs(format.id)">
							<v-list-item-icon><v-icon :name="format.icon" /></v-list-item-icon>
							<v-list-item-content>{{ format.label }}</v-list-item-content>
						</v-list-item>
					</v-list>
				</v-menu>
			</template>
			<v-button v-tooltip.bottom="'Reload'" rounded icon secondary :loading="loading" @click="loadGraph">
				<v-icon name="refresh" />
			</v-button>
		</template>

		<div class="dependency-graph">
			<v-notice v-if="!isAdmin" type="danger">Only administrators can use Content Dependency Graph.</v-notice>

			<template v-else>
				<div v-if="error" class="state">
					<p class="danger"><v-icon name="error" /> Couldn't load your collections: {{ error }}</p>
					<v-button small secondary @click="loadGraph">Try again</v-button>
				</div>

				<v-skeleton-loader v-else-if="loading && !graph" type="block-list-item-dense" />

				<template v-else-if="graph">
					<health-check
						v-if="healthOpened"
						v-show="view === 'health'"
						:key="graph.generatedAt"
						:graph="graph"
						@select="openCollection"
						@check="openCheck"
					/>

					<section v-if="view === 'map'" class="map">
						<p class="muted small">
							Arrows point from a collection to the one it uses. Drag to move, scroll to zoom, click a collection to highlight its links.
						</p>
						<div class="panel canvas-panel full">
							<graph-canvas :layout="fullLayout" :selected="selected" @select="highlight" />
						</div>
					</section>

					<template v-if="view === 'connections'">
						<p v-if="!selectedNode" class="state muted">
							You don't have any collections yet. Create one in Settings → Data Model.
						</p>

						<template v-else>
							<header class="title-row">
								<div>
									<h2 class="title">{{ collectionName(selected) }}</h2>
									<p v-if="selectedNode.note" class="muted small">{{ selectedNode.note }}</p>
								</div>
								<div class="title-actions">
									<router-link v-if="contentLink" :to="contentLink" class="link small">Open items</router-link>
									<v-button small :disabled="selected === 'directus_sessions'" @click="pickerOpen = true">
										<v-icon name="delete_sweep" left small /> Check an item
									</v-button>
								</div>
							</header>

							<impact-report
								v-if="checkItem"
								:collection="checkItem.collection"
								:pk="checkItem.pk"
								@close="checkItem = null"
								@check="openCheck"
							/>

							<div class="columns">
								<section class="panel">
									<h3 class="type-label">{{ collectionName(selected) }} uses</h3>
									<p v-if="connections.uses.length === 0" class="muted small">Nothing — it doesn't link to other collections.</p>
									<ul class="links">
										<li v-for="entry in connections.uses" :key="entry.key" v-tooltip="entry.technical.join('\n')">
											<v-icon :name="entry.amount === 'many' ? 'format_list_bulleted' : 'arrow_outward'" small />
											<strong>{{ fieldName(entry.owner, entry.field) }}</strong>
											<span class="muted">{{ entry.amount }} from</span>
											<template v-for="(target, index) in entry.targets" :key="target">
												<button class="link" @click="select(target)">{{ collectionName(target) }}</button>
												<span v-if="index < entry.targets.length - 1" class="muted">or</span>
											</template>
										</li>
									</ul>
								</section>

								<section class="panel">
									<h3 class="type-label">{{ collectionName(selected) }} is used by</h3>
									<p v-if="connections.usedBy.length === 0" class="muted small">Nothing links to it yet.</p>
									<ul class="links">
										<li v-for="entry in connections.usedBy" :key="entry.key" v-tooltip="entry.technical.join('\n')">
											<v-icon name="arrow_back" small />
											<button class="link" @click="select(entry.collection)">{{ collectionName(entry.collection) }}</button>
											<template v-if="entry.field">
												<span class="muted">→</span> {{ fieldName(entry.collection, entry.field) }}
											</template>
										</li>
									</ul>
								</section>
							</div>

							<div v-if="neighbourGraph.nodes.length > 1" class="panel canvas-panel">
								<graph-canvas :layout="neighbourLayout" :selected="selected" @select="select" />
							</div>
						</template>
					</template>

					<item-picker v-if="selectedNode" v-model="pickerOpen" :collection="selected" @pick="openCheck" />
				</template>
			</template>
		</div>
	</private-view>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useApi, useStores } from '@directus/extensions-sdk';
import { computeStats, filterGraph, findCycles } from '../shared/graph.js';
import { computeLayout } from '../shared/layout.js';
import { collectionRoute } from '../shared/links.js';
import { formatGraphJson, formatGraphSvg, formatMermaid } from '../shared/reports.js';
import { describeConnections } from '../shared/wording.js';
import GraphCanvas from './components/graph-canvas.vue';
import HealthCheck from './components/health-check.vue';
import ImpactReport from './components/impact-report.vue';
import ItemPicker from './components/item-picker.vue';
import { useNames } from './use-names.js';

const EXPORTS = [
	{ id: 'svg', label: 'Map as image (SVG)', icon: 'image' },
	{ id: 'json', label: 'Map as data (JSON)', icon: 'data_object' },
	{ id: 'mermaid', label: 'Mermaid diagram', icon: 'schema' },
];

const api = useApi();
const { useUserStore } = useStores();
const userStore = useUserStore();
const { collectionName, collectionIcon, fieldName } = useNames();
const isAdmin = computed(() => userStore.currentUser?.admin_access === true);

const graph = ref(null);
const loading = ref(false);
const error = ref(null);
const view = ref('connections');
const healthOpened = ref(false);
const navSearch = ref('');
const includeSystem = ref(false);
const selected = ref(null);
const checkItem = ref(null);
const pickerOpen = ref(false);

const degree = computed(() => {
	const counts = new Map();
	for (const edge of graph.value?.edges ?? []) {
		counts.set(edge.source, (counts.get(edge.source) ?? 0) + 1);
		if (edge.target !== edge.source) counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1);
	}
	return counts;
});

const navCollections = computed(() => {
	const needle = navSearch.value.trim().toLowerCase();
	return (graph.value?.collections ?? [])
		.filter((node) => includeSystem.value || !node.system)
		.filter((node) => !needle || node.id.toLowerCase().includes(needle) || collectionName(node.id).toLowerCase().includes(needle))
		.sort((a, b) => Number(a.system) - Number(b.system) || collectionName(a.id).localeCompare(collectionName(b.id)));
});

const selectedNode = computed(() => graph.value?.collections.find((node) => node.id === selected.value) ?? null);
const contentLink = computed(() => (selected.value ? collectionRoute(selected.value) : null));
const connections = computed(() => describeConnections(graph.value?.edges ?? [], selected.value));

const withLabels = (nodes) => nodes.map((node) => ({ ...node, label: collectionName(node.id) }));

const neighbourGraph = computed(() => {
	if (!graph.value || !selected.value) return { nodes: [], edges: [] };
	const { uses, usedBy } = connections.value;
	const vias = new Set([...uses, ...usedBy].map((entry) => entry.via).filter(Boolean));
	const ids = new Set([selected.value, ...vias, ...uses.flatMap((entry) => entry.targets), ...usedBy.map((entry) => entry.collection)]);
	return {
		nodes: withLabels(graph.value.collections.filter((node) => ids.has(node.id))),
		edges: graph.value.edges.filter(
			(edge) => ids.has(edge.source) && ids.has(edge.target) && (edge.source === selected.value || edge.target === selected.value || vias.has(edge.source)),
		),
	};
});

const fullGraph = computed(() => {
	const filtered = graph.value ? filterGraph(graph.value, { includeSystem: includeSystem.value }) : { nodes: [], edges: [] };
	return { nodes: withLabels(filtered.nodes), edges: filtered.edges };
});

const neighbourLayout = computed(() => computeLayout(neighbourGraph.value));
const fullLayout = computed(() => computeLayout(fullGraph.value));

onMounted(() => {
	if (isAdmin.value) loadGraph();
});

async function loadGraph() {
	loading.value = true;
	error.value = null;

	try {
		const { data } = await api.get('/content-dependency-graph/graph');
		graph.value = data;
		if (!data.collections.some((node) => node.id === selected.value)) selected.value = defaultCollection(data);
	} catch (err) {
		error.value = err?.response?.data?.errors?.[0]?.message ?? err.message;
	} finally {
		loading.value = false;
	}
}

function defaultCollection(data) {
	const user = filterGraph(data, { includeSystem: false });
	const [top] = computeStats(filterGraph(data, { includeSystem: true })).mostConnected.filter((entry) => !entry.id.startsWith('directus_'));
	return top?.id ?? user.nodes[0]?.id ?? null;
}

function select(id) {
	if (!id) return;
	if (id !== selected.value) checkItem.value = null;
	selected.value = id;
	if (id.startsWith('directus_')) includeSystem.value = true;
	if (view.value === 'health') view.value = 'connections';
}

function highlight(id) {
	if (id) selected.value = id;
}

function toggleView(target) {
	view.value = view.value === target ? 'connections' : target;
	if (view.value === 'health') healthOpened.value = true;
}

function openCollection(id) {
	select(id);
	view.value = 'connections';
}

function openCheck(item) {
	openCollection(item.collection);
	checkItem.value = { collection: item.collection, pk: item.pk };
}

function exportAs(format) {
	const stamp = new Date().toISOString().replaceAll(':', '-');
	const files = {
		svg: () => [formatGraphSvg(fullLayout.value), 'image/svg+xml', 'svg'],
		json: () => {
			const cycles = findCycles(fullGraph.value);
			const stats = computeStats(fullGraph.value, cycles);
			return [formatGraphJson({ graph: fullGraph.value, stats, cycles, filters: { includeSystem: includeSystem.value } }), 'application/json', 'json'];
		},
		mermaid: () => [formatMermaid(fullGraph.value), 'text/plain', 'mmd'],
	};

	const [content, type, extension] = files[format]();
	const blob = new Blob([content], { type: `${type};charset=utf-8` });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = `content-dependency-graph-${stamp}.${extension}`;
	anchor.click();
	URL.revokeObjectURL(url);
}
</script>

<style scoped>
.dependency-graph {
	padding: var(--content-padding);
	padding-bottom: var(--content-padding-bottom);
}

.nav {
	display: flex;
	flex-direction: column;
	gap: 8px;
	min-height: 100%;
	padding: 12px;
}

.nav-list { flex: 1; }

.nav-name {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.nav-count {
	margin-left: auto;
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

.nav-empty { margin: 0 8px; }
.nav-system { margin-top: 8px; }

.panel {
	background: var(--theme--background-subdued);
	border: var(--theme--border-width) solid var(--theme--border-color-subdued);
	border-radius: var(--theme--border-radius);
	padding: 20px;
	margin-bottom: 20px;
}

.state {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 12px;
}

.state p { display: flex; align-items: center; gap: 8px; margin: 0; }

.title-row {
	display: flex;
	flex-wrap: wrap;
	justify-content: space-between;
	align-items: flex-start;
	gap: 12px;
	margin-bottom: 20px;
}

.title {
	margin: 0;
	font-size: 22px;
	font-weight: 700;
}

.title-row p { margin: 4px 0 0; }

.title-actions {
	display: flex;
	align-items: center;
	gap: 16px;
}

.columns {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
	gap: 0 20px;
}

h3 { margin: 0 0 12px; }

.links {
	display: flex;
	flex-direction: column;
	gap: 8px;
	margin: 0;
	padding: 0;
	list-style: none;
}

.links li {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 6px;
}

.links .v-icon { color: var(--theme--foreground-subdued); }

.canvas-panel {
	height: 360px;
	padding: 0;
	overflow: hidden;
}

.canvas-panel.full { height: calc(100vh - 240px); min-height: 420px; }

.map p { margin: 0 0 12px; }

.link {
	padding: 0;
	color: var(--theme--primary);
	background: none;
	border: none;
	cursor: pointer;
	font: inherit;
}

.danger { color: var(--theme--danger); }
.muted { color: var(--theme--foreground-subdued); }
.small { font-size: 13px; }
.header-icon { margin-right: 8px; }
</style>
