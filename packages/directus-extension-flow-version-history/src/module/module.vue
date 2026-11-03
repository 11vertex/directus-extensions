<template>
	<private-view title="Flow Version History">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="history" />
			</v-button>
		</template>

		<template #actions>
			<template v-if="isAdmin">
				<v-button
					v-tooltip.bottom="'Refresh'"
					rounded
					icon
					secondary
					:loading="loadingHistory"
					@click="refresh"
				>
					<v-icon name="refresh" />
				</v-button>
				<v-menu placement="bottom-end" show-arrow>
					<template #activator="{ toggle }">
						<v-button
							v-tooltip.bottom="'Export'"
							rounded
							icon
							secondary
							:disabled="!events.length"
							@click="toggle"
						>
							<v-icon name="download" />
						</v-button>
					</template>
					<v-list>
						<v-list-item clickable @click="exportReport('json')">
							<v-list-item-content>Changes as JSON</v-list-item-content>
						</v-list-item>
						<v-list-item clickable @click="exportReport('csv')">
							<v-list-item-content>Changes as CSV</v-list-item-content>
						</v-list-item>
					</v-list>
				</v-menu>
			</template>
		</template>

		<div class="version-history">
			<v-notice v-if="!isAdmin" type="danger">
				Only administrators can use Flow Version History.
			</v-notice>

			<template v-else>
				<div class="toolbar">
					<v-select
						v-model="flowId"
						class="flow-select"
						:items="flowItems"
						item-text="text"
						item-value="value"
						placeholder="Pick a flow"
					/>
					<v-icon v-tooltip.bottom="INFO_TEXT" class="info-icon" name="info" small />
				</div>

				<p v-if="error" class="error-line">
					<v-icon name="error" small />
					{{ error }}
					<button type="button" class="link" @click="refresh">Try again</button>
				</p>

				<p v-if="loadedFlows && !flows.length" class="muted">
					No flows yet. Create one in Settings → Flows and its changes will show up here.
				</p>

				<div v-else class="workspace">
					<section class="panel timeline">
						<p class="legend">
							<span><v-icon name="add_circle" x-small class="success" /> added</span>
							<span><v-icon name="edit" x-small class="primary" /> changed</span>
							<span><v-icon name="remove_circle" x-small class="danger" /> removed</span>
						</p>

						<p v-if="loadingHistory && !events.length" class="muted">Loading changes…</p>
						<p v-else-if="flowId && !events.length" class="muted">
							No changes recorded for this flow yet.
						</p>

						<button
							v-for="event in events"
							:key="event.id"
							type="button"
							class="change-row"
							:class="{ active: selectedId === event.id }"
							@click="selectEvent(event.id)"
						>
							<v-icon :name="actionIcon(event.action)" :class="actionTone(event.action)" small />
							<span class="change-text">
								<strong>{{ sentence(event) }}</strong>
								<span class="muted">
									{{ when(event.timestamp) }}
									<template v-if="event.action === 'update' && fieldsText(event)">
										— changed: {{ fieldsText(event) }}
									</template>
								</span>
							</span>
						</button>

						<v-button
							v-if="canLoadMore"
							class="load-more"
							secondary
							small
							full-width
							:loading="loadingHistory"
							@click="loadHistory()"
						>
							Load more
						</v-button>
					</section>

					<section class="panel change-detail">
						<p v-if="loadingDetail" class="muted">Loading change…</p>
						<p v-else-if="!detail" class="muted">Pick a change on the left to see what changed.</p>

						<template v-else>
							<header class="detail-header">
								<div>
									<h2>{{ sentence(detail) }}</h2>
									<p class="muted" :title="absoluteTime(detail.timestamp)">{{ when(detail.timestamp) }}</p>
								</div>
								<div class="detail-actions">
									<v-button small :secondary="!showGraph" @click="showGraph = !showGraph">
										{{ showGraph ? 'Hide flow' : 'Show flow at this point' }}
									</v-button>
									<span v-tooltip.bottom="compareHint">
										<v-button
											small
											:secondary="!showCurrent"
											:disabled="!detail.hasRevision"
											@click="showCurrent = !showCurrent"
										>
											Compare with current
										</v-button>
									</span>
								</div>
							</header>

							<h3>{{ detail.action === 'delete' ? 'What was removed' : 'What changed' }}</h3>
							<p v-if="!detail.changes?.length" class="muted">
								{{ noChangesText }}
							</p>
							<table v-else class="before-after">
								<thead>
									<tr>
										<th>Field</th>
										<th>Before</th>
										<th>After</th>
									</tr>
								</thead>
								<tbody>
									<tr v-for="row in detail.changes" :key="row.path">
										<th scope="row">{{ fieldDetailLabel(row.path) }}</th>
										<td>
											<value-cell
												:value="row.before"
												:path="row.path"
												:step-names="stepNames"
												:unknown="row.beforeUnknown"
											/>
										</td>
										<td><value-cell :value="row.after" :path="row.path" :step-names="stepNames" /></td>
									</tr>
								</tbody>
							</table>

							<section v-if="showCurrent" class="block">
								<h3>Compared with now</h3>
								<p v-if="!detail.currentExists" class="muted">
									This {{ detail.entity === 'flow' ? 'flow' : 'step' }} no longer exists.
								</p>
								<p v-else-if="!currentRows.length" class="muted">
									Nothing has changed since. This is how it looks today.
								</p>
								<table v-else class="before-after">
									<thead>
										<tr>
											<th>Field</th>
											<th>At this point</th>
											<th>Now</th>
										</tr>
									</thead>
									<tbody>
										<tr v-for="row in currentRows" :key="row.path">
											<th scope="row">{{ fieldDetailLabel(row.path) }}</th>
											<td><value-cell :value="row.before" :path="row.path" :step-names="stepNames" /></td>
											<td><value-cell :value="row.after" :path="row.path" :step-names="stepNames" /></td>
										</tr>
									</tbody>
								</table>
							</section>

							<details class="technical">
								<summary>Technical details</summary>
								<dl>
									<dt>Activity id</dt>
									<dd>{{ detail.id }}</dd>
									<dt>Item id</dt>
									<dd>{{ detail.itemId || '—' }}</dd>
									<dt>Collection</dt>
									<dd>{{ detail.collection }}</dd>
								</dl>
								<div class="type-label">Saved snapshot (secrets hidden)</div>
								<pre>{{ pretty(detail.snapshot) }}</pre>
							</details>
						</template>
					</section>
				</div>

				<section v-if="detail && showGraph" class="panel graph-pane">
					<flow-graph
						:graph="detail.graph"
						:highlight-id="highlightCardId"
						:title="`The flow as it was ${when(detail.timestamp)}`"
						subtitle="Rebuilt from saved history. Some connecting lines may be missing."
					/>
				</section>
			</template>
		</div>
	</private-view>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useApi, useStores } from '@directus/extensions-sdk';
import { formatHistoryCsv, formatHistoryJson } from '../shared/reports.js';
import {
	changeSentence,
	changedFieldsText,
	fieldDetailLabel,
	meaningfulChanges,
	pickMostRecentFlow,
	relativeTime,
} from '../shared/change-text.js';
import FlowGraph from './flow-graph.vue';
import ValueCell from './value-cell.vue';

const LIMIT = 25;
const INFO_TEXT =
	'Built from Directus activity history (read-only). Deleted steps keep no saved values, and old history may be cleaned up by retention settings. Secrets are hidden.';

const api = useApi();
const { useUserStore } = useStores();
const userStore = useUserStore();
const isAdmin = computed(() => userStore.currentUser?.admin_access === true);
const currentUserId = computed(() => userStore.currentUser?.id ?? null);

const flows = ref([]);
const loadedFlows = ref(false);
const flowId = ref(null);
const events = ref([]);
const page = ref(0);
const total = ref(0);
const selectedId = ref(null);
const detail = ref(null);
const showGraph = ref(false);
const showCurrent = ref(false);
const error = ref(null);
const loadingHistory = ref(false);
const loadingDetail = ref(false);
const now = ref(Date.now());

const flowItems = computed(() => flows.value.map((flow) => ({ text: flow.name, value: flow.id })));
const canLoadMore = computed(() => events.value.length < total.value);
const stepNames = computed(() =>
	Object.fromEntries((detail.value?.graph?.panels ?? []).map((panel) => [panel.id, panel.name])),
);
const highlightCardId = computed(() =>
	detail.value?.entity === 'operation' ? detail.value.itemId : '$trigger',
);
const currentRows = computed(() => meaningfulChanges(detail.value?.currentDiff));
const compareHint = computed(() =>
	detail.value?.hasRevision
		? 'See how this differs from the flow today'
		: 'Nothing was saved for this change, so it cannot be compared.',
);
const noChangesText = computed(() => {
	if (detail.value?.action === 'delete') return 'The values before it was removed were not saved.';
	if (detail.value?.action === 'create') return 'It was created with default settings.';
	return 'No field details were saved for this change.';
});

let clock = null;
let selectToken = 0;

watch(flowId, () => {
	clearSelection();
	events.value = [];
	page.value = 0;
	total.value = 0;
	if (flowId.value) loadHistory({ reset: true });
});

onMounted(async () => {
	clock = setInterval(() => (now.value = Date.now()), 60000);
	if (isAdmin.value) await loadFlows();
});

onUnmounted(() => clearInterval(clock));

async function loadFlows() {
	error.value = null;
	try {
		const { data } = await api.get('/flow-version-history/meta');
		flows.value = data.flows ?? [];
		if (!flows.value.some((flow) => flow.id === flowId.value)) {
			flowId.value = pickMostRecentFlow(flows.value)?.id ?? null;
		}
	} catch (err) {
		error.value = friendlyError(err);
	} finally {
		loadedFlows.value = true;
	}
}

async function refresh() {
	await loadFlows();
	if (flowId.value) await loadHistory({ reset: true });
}

async function loadHistory({ reset = false } = {}) {
	if (!flowId.value) return;
	loadingHistory.value = true;
	error.value = null;
	const nextPage = reset ? 1 : page.value + 1;
	try {
		const { data } = await api.get('/flow-version-history/history', {
			params: { flowId: flowId.value, page: nextPage, limit: LIMIT },
		});
		const items = data.items ?? [];
		events.value = reset ? items : [...events.value, ...items];
		page.value = nextPage;
		total.value = data.total ?? events.value.length;
		if (reset) {
			const keep = events.value.some((event) => event.id === selectedId.value);
			if (!keep && events.value[0]) selectEvent(events.value[0].id);
		}
	} catch (err) {
		error.value = friendlyError(err);
	} finally {
		loadingHistory.value = false;
	}
}

async function selectEvent(id) {
	const token = ++selectToken;
	selectedId.value = id;
	showCurrent.value = false;
	loadingDetail.value = true;
	error.value = null;
	try {
		const { data } = await api.get(`/flow-version-history/history/${id}`);
		if (token === selectToken) detail.value = data;
	} catch (err) {
		if (token !== selectToken) return;
		detail.value = null;
		error.value = friendlyError(err);
	} finally {
		if (token === selectToken) loadingDetail.value = false;
	}
}

function clearSelection() {
	selectedId.value = null;
	detail.value = null;
	showGraph.value = false;
	showCurrent.value = false;
}

function sentence(event) {
	return changeSentence(event, currentUserId.value);
}

function fieldsText(event) {
	return changedFieldsText(event.changedPaths ?? event.changedFields);
}

function when(value) {
	return relativeTime(value, now.value);
}

function absoluteTime(value) {
	return value ? new Date(value).toLocaleString() : '';
}

function actionIcon(action) {
	if (action === 'create') return 'add_circle';
	if (action === 'delete') return 'remove_circle';
	return 'edit';
}

function actionTone(action) {
	if (action === 'create') return 'success';
	if (action === 'delete') return 'danger';
	return 'primary';
}

function pretty(value) {
	return value === undefined || value === null ? 'Nothing saved' : JSON.stringify(value, null, 2);
}

function friendlyError(err) {
	const message = err?.response?.data?.errors?.[0]?.message || err?.message;
	return message ? `Couldn't load history: ${message}` : "Couldn't load history.";
}

function exportReport(format) {
	if (!events.value.length) return;
	const list = { items: events.value, page: page.value, limit: LIMIT, total: total.value };
	const stamp = new Date().toISOString().replaceAll(':', '-');
	const content = format === 'json' ? formatHistoryJson(list, detail.value, null) : formatHistoryCsv(list);
	const blob = new Blob([content], {
		type: `${format === 'json' ? 'application/json' : 'text/csv'};charset=utf-8`,
	});
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = `flow-version-history-${stamp}.${format}`;
	anchor.click();
	URL.revokeObjectURL(url);
}
</script>

<style scoped>
.version-history {
	padding: var(--content-padding);
	padding-bottom: var(--content-padding-bottom);
	max-width: 1400px;
}

.header-icon {
	margin-right: 8px;
}

.toolbar {
	display: flex;
	align-items: center;
	gap: 12px;
	margin-bottom: 16px;
}

.flow-select {
	width: 320px;
	max-width: 100%;
}

.info-icon {
	color: var(--theme--foreground-subdued);
	cursor: help;
}

.error-line {
	display: flex;
	align-items: center;
	gap: 8px;
	color: var(--theme--danger);
	margin: 0 0 16px;
}

.link {
	background: none;
	border: none;
	padding: 0;
	color: var(--theme--primary);
	cursor: pointer;
	font: inherit;
}

.workspace {
	display: grid;
	grid-template-columns: minmax(280px, 380px) 1fr;
	gap: 20px;
	align-items: start;
}

@media (max-width: 960px) {
	.workspace {
		grid-template-columns: 1fr;
	}
}

.panel {
	background: var(--theme--background-subdued);
	border: var(--theme--border-width) solid var(--theme--border-color-subdued);
	border-radius: var(--theme--border-radius);
	padding: 16px;
}

.graph-pane {
	margin-top: 20px;
}

.legend {
	display: flex;
	gap: 12px;
	margin: 0 0 12px;
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

.change-row {
	display: flex;
	align-items: flex-start;
	gap: 10px;
	width: 100%;
	text-align: left;
	padding: 10px;
	margin-bottom: 6px;
	border: var(--theme--border-width) solid var(--theme--border-color-subdued);
	border-radius: var(--theme--border-radius);
	background: var(--theme--background);
	color: inherit;
	font: inherit;
	cursor: pointer;
}

.change-row.active {
	border-color: var(--theme--primary);
}

.change-text {
	display: flex;
	flex-direction: column;
	gap: 2px;
	min-width: 0;
}

.change-text strong {
	font-weight: 600;
}

.change-text span {
	font-size: 12px;
}

.load-more {
	margin-top: 8px;
}

.detail-header {
	display: flex;
	justify-content: space-between;
	gap: 12px;
	align-items: flex-start;
	flex-wrap: wrap;
	margin-bottom: 16px;
}

.detail-header h2 {
	margin: 0 0 4px;
	font-size: 18px;
	font-weight: 600;
}

.detail-header p {
	margin: 0;
}

.detail-actions {
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
}

h3 {
	margin: 0 0 8px;
	font-size: 15px;
	font-weight: 600;
}

.block {
	margin-top: 20px;
}

.before-after {
	width: 100%;
	border-collapse: collapse;
	table-layout: fixed;
	font-size: 14px;
}

.before-after th,
.before-after td {
	text-align: left;
	vertical-align: top;
	padding: 8px;
	border-bottom: var(--theme--border-width) solid var(--theme--border-color-subdued);
}

.before-after thead th {
	color: var(--theme--foreground-subdued);
	font-size: 12px;
	font-weight: 600;
}

.before-after tbody th {
	width: 30%;
	font-weight: 600;
}

.technical {
	margin-top: 20px;
}

.technical summary {
	cursor: pointer;
	color: var(--theme--foreground-subdued);
	font-size: 13px;
}

.technical dl {
	display: grid;
	grid-template-columns: max-content 1fr;
	gap: 4px 12px;
	font-size: 13px;
}

.technical dd {
	margin: 0;
	font-family: var(--theme--fonts--monospace--font-family), monospace;
}

pre {
	font-family: var(--theme--fonts--monospace--font-family), monospace;
	font-size: 12px;
	background: var(--theme--background);
	padding: 10px;
	border-radius: var(--theme--border-radius);
	overflow: auto;
	max-height: 320px;
	margin: 4px 0 8px;
}

.success {
	color: var(--theme--success);
}

.danger {
	color: var(--theme--danger);
}

.primary {
	color: var(--theme--primary);
}

.muted {
	color: var(--theme--foreground-subdued);
}
</style>
