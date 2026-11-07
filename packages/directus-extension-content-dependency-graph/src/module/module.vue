<template>
	<private-view title="Content Dependency Graph">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="account_tree" />
			</v-button>
		</template>

		<template v-if="isAdmin" #navigation>
			<div class="nav-activity">
				<div class="seg" role="group" aria-label="What to show">
					<button
						v-for="option in VIEWS"
						:key="option.id"
						type="button"
						:class="{ active: view === option.id }"
						@click="setView(option.id)"
					>
						{{ option.label }}
					</button>
				</div>

				<label class="field-label">Collection</label>
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
				<p v-if="graph && navCollections.length === 0" class="hint">No collections match.</p>

				<v-checkbox v-model="includeSystem" label="Show system collections" />
			</div>
		</template>

		<template #actions>
			<template v-if="isAdmin">
				<v-button v-tooltip.bottom="'Refresh'" rounded icon secondary :loading="loading" @click="loadGraph">
					<v-icon name="refresh" />
				</v-button>
				<v-menu v-if="graph" show-arrow placement="bottom-end">
					<template #activator="{ toggle }">
						<v-button v-tooltip.bottom="'Export'" rounded icon secondary @click="toggle">
							<v-icon name="download" />
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
		</template>

		<div class="dependency-graph">
			<v-notice v-if="!isAdmin" type="danger" class="padded">Only administrators can use Content Dependency Graph.</v-notice>

			<template v-else>
				<div v-if="error" class="padded state">
					<p class="danger"><v-icon name="error" /> Couldn't load your collections: {{ error }}</p>
					<v-button small secondary @click="loadGraph">Try again</v-button>
				</div>

				<v-skeleton-loader v-else-if="loading && !graph" type="block-list-item-dense" class="padded" />

				<template v-else-if="graph">
					<v-info
						v-if="!selectedNode && view !== 'health'"
						class="empty"
						icon="account_tree"
						title="No collections yet"
						center
					>
						Create a collection in Settings → Data Model and its links will show up here.
					</v-info>

					<template v-else>
						<header class="run-bar">
							<div class="run-title">
								<template v-if="view === 'health'">
									<strong>Health check</strong>
									<span class="muted">Unused or broken content, circular links and collections that stand alone.</span>
								</template>
								<template v-else-if="view === 'map'">
									<strong>All collections</strong>
									<span class="pill">{{ fullGraph.nodes.length }} collections</span>
									<span class="muted">Arrows point to the collection that is used.</span>
								</template>
								<template v-else>
									<strong>{{ collectionName(selected) }}</strong>
									<span class="pill">uses {{ connections.uses.length }}</span>
									<span class="pill">used by {{ connections.usedBy.length }}</span>
									<span v-if="selectedNode.note" class="muted">{{ selectedNode.note }}</span>
								</template>
							</div>
							<div v-if="view === 'connections'" class="run-actions">
								<router-link v-if="contentLink" :to="contentLink" class="link small">Open items</router-link>
								<v-button small secondary :disabled="selected === 'directus_sessions'" @click="pickerOpen = true">
									<v-icon name="delete_sweep" left small /> Check an item
								</v-button>
							</div>
						</header>

						<div class="body">
							<health-check
								v-if="healthOpened"
								v-show="view === 'health'"
								:key="graph.generatedAt"
								:graph="graph"
								@select="openCollection"
								@check="openCheck"
							/>

							<graph-canvas v-if="view === 'map'" class="fill" :layout="fullLayout" :selected="selected" @select="highlight" />

							<template v-if="view === 'connections'">
								<impact-report
									v-if="checkItem"
									:collection="checkItem.collection"
									:pk="checkItem.pk"
									@close="checkItem = null"
									@check="openCheck"
								/>

								<div class="columns">
									<section class="section">
										<h3 class="type-label">{{ collectionName(selected) }} uses</h3>
										<p v-if="connections.uses.length === 0" class="muted small">Nothing. It doesn't link to other collections.</p>
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

									<section class="section">
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

								<div v-if="neighbourGraph.nodes.length > 1" class="neighbours">
									<graph-canvas :layout="neighbourLayout" :selected="selected" @select="select" />
								</div>
							</template>
						</div>
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

const VIEWS = [
	{ id: 'connections', label: 'Links' },
	{ id: 'map', label: 'Map' },
	{ id: 'health', label: 'Health' },
];

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

function setView(target) {
	view.value = target;
	if (target === 'health') healthOpened.value = true;
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
	display: flex;
	flex-direction: column;
	height: calc(100vh - 64px);
	min-height: 420px;
}

.padded {
	margin: var(--content-padding);
}

.empty {
	flex: 1;
}

.header-icon {
	margin-right: 8px;
}

.nav-activity {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 12px 12px 20px;
}

.seg {
	display: flex;
	border: var(--theme--border-width) solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	overflow: hidden;
}

.seg button {
	flex: 1;
	padding: 5px 10px;
	border: none;
	background: transparent;
	color: var(--theme--foreground-subdued);
	font: inherit;
	font-size: 13px;
	cursor: pointer;
}

.seg button + button {
	border-left: var(--theme--border-width) solid var(--theme--border-color);
}

.seg button.active {
	background: color-mix(in srgb, var(--theme--primary) 16%, transparent);
	color: var(--theme--primary);
	font-weight: 600;
}

.field-label {
	margin-top: 8px;
	color: var(--theme--foreground-subdued);
	font-size: 12px;
	font-weight: 600;
	letter-spacing: 0.04em;
	text-transform: uppercase;
}

.hint {
	margin: 0;
	color: var(--theme--foreground-subdued);
	font-size: 12px;
}

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

.run-bar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16px;
	min-height: 64px;
	padding: 12px var(--content-padding);
	border-bottom: var(--theme--border-width) solid var(--theme--border-color-subdued);
}

.run-title {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 10px;
	min-width: 0;
}

.run-actions {
	display: flex;
	align-items: center;
	gap: 16px;
	margin-left: auto;
}

.pill {
	padding: 0 8px;
	border-radius: 999px;
	background: color-mix(in srgb, var(--theme--primary) 16%, transparent);
	color: var(--theme--primary);
	font-size: 11px;
	font-weight: 600;
	line-height: 18px;
}

.body {
	display: flex;
	flex: 1;
	flex-direction: column;
	min-height: 0;
	overflow: auto;
}

.fill {
	flex: 1;
	min-height: 0;
}

.state {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 12px;
}

.state p {
	display: flex;
	align-items: center;
	gap: 8px;
	margin: 0;
}

.columns {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
}

.section {
	padding: 20px var(--content-padding);
	border-bottom: var(--theme--border-width) solid var(--theme--border-color-subdued);
}

h3 {
	margin: 0 0 12px;
}

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

.links .v-icon {
	color: var(--theme--foreground-subdued);
}

.neighbours {
	flex: 1;
	min-height: 360px;
}

.link {
	padding: 0;
	color: var(--theme--primary);
	background: none;
	border: none;
	cursor: pointer;
	font: inherit;
}

.danger {
	color: var(--theme--danger);
}

.muted {
	color: var(--theme--foreground-subdued);
}

.small {
	font-size: 13px;
}
</style>
