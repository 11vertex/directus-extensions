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

		<template v-if="isAdmin" #navigation>
			<div class="nav-activity">
				<div class="nav-top">
					<v-select
						v-model="flowId"
						class="flow-select"
						:items="flowItems"
						item-text="text"
						item-value="value"
						show-deselect
						placeholder="Pick a flow"
					/>
					<div v-if="flowId" class="nav-meta">
						<span>{{ versionCount }} {{ versionCount === 1 ? 'version' : 'versions' }}</span>
						<v-icon v-tooltip.bottom="INFO_TEXT" class="info-icon" name="info" x-small />
					</div>
				</div>

				<p v-if="loadingHistory && !events.length" class="muted note">Loading versions…</p>
				<p v-else-if="flowId && !events.length" class="muted note">No changes recorded for this flow yet.</p>

				<template v-for="section in sections" :key="section.label">
					<h4 class="day">{{ section.label }}</h4>

					<button
						v-for="group in section.groups"
						:key="group.key"
						type="button"
						class="row"
						:class="{ active: endOf(group) === selectedId }"
						:data-event-id="endOf(group)"
						:title="detailsOf(group)"
						@click="selectVersion(group)"
					>
						<v-icon :name="versionIcon(group)" :class="versionTone(group)" small />
						<span class="row-text">
							<span class="row-main">
								<span class="parts">
									<span v-if="actorOf(group)" class="actor">{{ actorOf(group) }}</span>
									<span class="pills">
										<span v-for="part in parts(group)" :key="part.kind" class="pill" :class="part.kind">{{ pillText(part) }}</span>
									</span>
									<span v-if="cardTypes(group)" class="types">{{ cardTypes(group) }}</span>
								</span>
								<span class="time" :title="absoluteTime(group.timestamp)">{{ short(group.timestamp) }}</span>
							</span>
							<span v-if="endOf(group) === latestId" class="row-detail">Current version</span>
						</span>
					</button>
				</template>

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

			</div>
		</template>

		<div class="version-history">
			<v-notice v-if="!isAdmin" type="danger">
				Only administrators can use Flow Version History.
			</v-notice>

			<template v-else>
				<p v-if="error" class="error-line">
					<v-icon name="error" small />
					{{ error }}
					<button type="button" class="link" @click="refresh">Try again</button>
				</p>

				<p v-if="loadedFlows && !flows.length" class="muted">
					No flows yet. Create one in Settings → Flows and its changes will show up here.
				</p>

				<template v-else>
					<section class="panel graph-pane">
						<v-info v-if="!flowId" class="empty" icon="history" title="Pick a flow" center>
							Choose a flow in the sidebar to see how it changed over time.
						</v-info>
						<v-info v-else-if="!events.length && !loadingHistory" class="empty" icon="history" title="No changes yet" center>
							No changes have been recorded for this flow yet.
						</v-info>
						<v-info v-else-if="!detail && !loadingDetail && !loadingHistory" class="empty" icon="history" title="Pick a version" center>
							Choose a version in the sidebar to see the flow as it was.
						</v-info>
						<p v-else-if="!detail" class="muted">Loading the flow…</p>
						<flow-graph
							v-else
							:graph="detail.graph"
							:highlight-ids="highlightIds"
							:title="graphTitle"
						>
							<template #actions>
								<div class="seg" role="group" aria-label="Which version to show">
									<button
										type="button"
										:class="{ active: view === 'before' }"
										:disabled="!previousId"
										:title="previousId ? 'Show the flow just before this change' : beforeNote"
										@click="setView('before')"
									>
										Before
									</button>
									<button type="button" :class="{ active: view === 'after' }" @click="setView('after')">After</button>
								</div>
								<v-button small secondary :disabled="isLatest" :loading="restoring" @click="confirmRestore = true">
									<v-icon name="restore" left small />
									Restore this version
								</v-button>
							</template>
						</flow-graph>
					</section>
				</template>
			</template>
		</div>

		<v-dialog v-model="confirmRestore" @esc="confirmRestore = false">
			<v-card>
				<v-card-title>Restore this version?</v-card-title>
				<v-card-text>
					The flow will go back to what you see now ({{ graphTitle.replace(/^The flow /, '').toLowerCase() }}): its
					settings, steps and connections. Steps added since then are removed. The restore is saved as a new version,
					so you can undo it from this list.
				</v-card-text>
				<v-card-actions>
					<v-button secondary @click="confirmRestore = false">Cancel</v-button>
					<v-button :loading="restoring" @click="restore">Restore</v-button>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</private-view>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useApi, useExtensions, useStores } from '@directus/extensions-sdk';
import { formatHistoryCsv, formatHistoryJson } from '../shared/reports.js';
import {
	SAVE_GAP_MS,
	changeSentence,
	changedFieldsText,
	dayLabel,
	findSaveEnd,
	groupEvents,
	groupHeadline,
	groupParts,
	groupStepTypes,
	isRevert,
	actorTag,
	isPlumbingOnly,
	previousSaveEnd,
	saveEvents,
	relativeTime,
	shortTime,
	withStepNames,
} from '../shared/change-text.js';
import FlowGraph from './flow-graph.vue';

const LIMIT = 100;
const INFO_TEXT =
	'Built from Directus activity history (read-only). Deleted steps keep no saved values, and old history may be cleaned up by retention settings. Secrets are hidden.';

const api = useApi();
const extensions = useExtensions();
const { useUserStore } = useStores();
const userStore = useUserStore();
const isAdmin = computed(() => userStore.currentUser?.admin_access === true);
const currentUserId = computed(() => userStore.currentUser?.id ?? null);

const flows = ref([]);
const loadedFlows = ref(false);
let loadingFlows = false;
const flowId = ref(null);
const events = ref([]);
const page = ref(0);
const total = ref(0);
const selectedId = ref(null);
const detail = ref(null);
const error = ref(null);
const loadingHistory = ref(false);
const loadingDetail = ref(false);
const now = ref(Date.now());

const flowItems = computed(() => flows.value.map((flow) => ({ text: flow.name, value: flow.id })));
const canLoadMore = computed(() => events.value.length < total.value);

// A removed step has no name in the history; borrow it from earlier changes to the same step.
const shownEvents = computed(() => withStepNames(events.value));

// One Save in the flow editor is recorded as several events. Those together are one version of the flow,
// and a version is what the list shows and what the picture draws.
const view = ref('after');
const graphEventId = ref(null);

const latestId = computed(() => events.value[0]?.id ?? null);
const endOf = (group) => findSaveEnd(events.value, group.events[0].id);

const versions = computed(() => groupEvents(shownEvents.value, SAVE_GAP_MS));
const versionCount = computed(() => versions.value.length);

const sections = computed(() => {
	const result = [];
	for (const group of versions.value) {
		const label = dayLabel(group.timestamp, now.value);
		const last = result[result.length - 1];
		if (last?.label === label) last.groups.push(group);
		else result.push({ label, groups: [group] });
	}
	return result;
});

// What the selected version changed, and the version just before it.
const selectedSave = computed(() => saveEvents(shownEvents.value, selectedId.value));
const previousId = computed(() => previousSaveEnd(events.value, selectedId.value));
const beforeNote = computed(() =>
	canLoadMore.value ? 'Load more history to see the version before this one.' : 'This is the first version of the flow.',
);

const parts = (group) => groupParts(group);

// The kind of card each step is, named the way the flow editor names it ("Send Discord Message").
const operationNames = computed(() => {
	const operations = extensions.operations?.value ?? extensions.operations ?? [];
	return new Map(operations.map((operation) => [operation.id, operation.name]));
});
const humanize = (value) => String(value).replace(/[_-]+/g, ' ').replace(/^./, (character) => character.toUpperCase());
const cardTypes = (group) =>
	groupStepTypes(group)
		.map((type) => (type === 'trigger' ? 'Trigger' : operationNames.value.get(type) ?? humanize(type)))
		.join(' · ');
const actorOf = (group) => actorTag(group.actor, currentUserId.value).replace(/:\s*$/, '');
// Just the kind of change, with a count when more than one step is involved.
const pillText = (part) => (part.names.length > 1 && part.kind !== 'reverted' ? `${part.label} ${part.names.length}` : part.label);
const headline = (group) => groupHeadline(group, currentUserId.value);
const short = (value) => shortTime(value, now.value);
const detailsOf = (group) => [...group.events].reverse().map((event) => sentence(event)).join('\n');

function versionIcon(group) {
	if (group.events.some(isRevert)) return 'restore';
	const actions = new Set(group.events.map((event) => event.action));
	if (actions.size > 1) return 'layers';
	return actionIcon([...actions][0]);
}

function versionTone(group) {
	if (group.events.some(isRevert)) return 'warning';
	const actions = new Set(group.events.map((event) => event.action));
	return actions.size > 1 ? 'primary' : actionTone([...actions][0]);
}

const isLatest = computed(() => Boolean(latestId.value) && graphEventId.value === latestId.value);
const graphTitle = computed(() => {
	if (view.value === 'before') return `Just before this change · ${when(detail.value?.timestamp)}`;
	return isLatest.value ? 'Current version' : `Version from ${when(detail.value?.timestamp)}`;
});

// The cards this change touched. A rewired flow's trigger counts only when its own settings changed.
const highlightIds = computed(() => {
	const ids = new Set();
	for (const event of selectedSave.value) {
		if (event.entity === 'operation') ids.add(event.itemId);
		else if (event.action !== 'update' || !isPlumbingOnly(event)) ids.add('$trigger');
	}
	return [...ids];
});

// Move through the versions with the arrow keys: up is newer, down is older.
function selectVersion(group) {
	selectEvent(endOf(group));
}

function setView(next) {
	if (next === view.value || (next === 'before' && !previousId.value)) return;
	view.value = next;
	loadGraph(next === 'before' ? previousId.value : selectedId.value);
}

let clock = null;
let selectToken = 0;

watch(flowId, (id) => {
	if (loadedFlows.value) rememberFlow(id ?? null);
	clearSelection();
	events.value = [];
	page.value = 0;
	total.value = 0;
	if (flowId.value) loadHistory({ reset: true });
});

onMounted(() => {
	clock = setInterval(() => (now.value = Date.now()), 60000);
});

// Load as soon as we know the user is an administrator. The profile can finish loading after the
// page opens (for example right after a reload), so asking only once on mount could miss it.
watch(
	isAdmin,
	(admin) => {
		if (admin && !loadedFlows.value && !loadingFlows) loadFlows();
	},
	{ immediate: true },
);

onUnmounted(() => clearInterval(clock));


// The chosen flow is remembered per user in Directus' own presets table (collection "flow-version-history" is only a label,
// nothing else reads it), so it comes back on the next visit and on other browsers.
const PRESET_KEY = 'flow-version-history';
let presetId = null;

async function rememberedFlow() {
	const userId = currentUserId.value;
	if (!userId) return null;
	try {
		const { data } = await api.get('/presets', {
			params: { filter: { user: { _eq: userId }, collection: { _eq: PRESET_KEY } }, fields: 'id,layout_options', limit: 1 },
		});
		const preset = data.data?.[0];
		presetId = preset?.id ?? null;
		return preset?.layout_options?.flowId ?? null;
	} catch {
		return null;
	}
}

async function rememberFlow(id) {
	const userId = currentUserId.value;
	if (!userId) return;
	try {
		if (presetId) await api.patch(`/presets/${presetId}`, { layout_options: { flowId: id } });
		else {
			const { data } = await api.post('/presets', { user: userId, collection: PRESET_KEY, layout_options: { flowId: id } });
			presetId = data.data?.id ?? null;
		}
	} catch {
		// Remembering is a convenience; ignore failures.
	}
}

async function loadFlows() {
	loadingFlows = true;
	error.value = null;
	try {
		const { data } = await api.get('/flow-version-history/meta');
		flows.value = data.flows ?? [];
		if (!flows.value.some((flow) => flow.id === flowId.value)) {
			const saved = await rememberedFlow();
			flowId.value = flows.value.some((flow) => flow.id === saved) ? saved : null;
		}
	} catch (err) {
		error.value = friendlyError(err);
	} finally {
		loadedFlows.value = true;
		loadingFlows = false;
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
	selectedId.value = findSaveEnd(events.value, id);
	view.value = 'after';
	await loadGraph(selectedId.value);
}

async function loadGraph(id) {
	const token = ++selectToken;
	graphEventId.value = id;
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

const confirmRestore = ref(false);
const restoring = ref(false);

async function restore() {
	if (!graphEventId.value || !flowId.value) return;
	restoring.value = true;
	error.value = null;
	try {
		await api.post(`/flow-version-history/restore/${graphEventId.value}`, { flowId: flowId.value });
		confirmRestore.value = false;
		await loadHistory({ reset: true });
		if (events.value[0]) await selectEvent(events.value[0].id);
	} catch (err) {
		confirmRestore.value = false;
		error.value = friendlyError(err);
	} finally {
		restoring.value = false;
	}
}

function clearSelection() {
	selectedId.value = null;
	detail.value = null;
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
	display: flex;
	flex-direction: column;
	height: calc(100vh - 64px);
	min-height: 420px;
}

.version-history > :not(.graph-pane) {
	margin: var(--content-padding);
}

.header-icon {
	margin-right: 8px;
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

.nav-activity {
	display: flex;
	flex-direction: column;
	gap: 2px;
	padding: 12px 12px 20px;
}

.nav-top {
	display: flex;
	flex-direction: column;
	gap: 8px;
	margin-bottom: 8px;
}

.nav-meta {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0 2px;
	color: var(--theme--foreground-subdued);
	font-size: 12px;
}

.info-icon {
	cursor: help;
}

.note {
	margin: 8px 2px;
	font-size: 13px;
}

.day {
	position: sticky;
	top: 0;
	z-index: 1;
	margin: 10px -12px 4px;
	padding: 6px 14px;
	background: var(--theme--navigation--background, var(--theme--background-normal));
	color: var(--theme--foreground-subdued);
	font-size: 11px;
	font-weight: 600;
	letter-spacing: 0.05em;
	text-transform: uppercase;
}

.row {
	display: flex;
	align-items: flex-start;
	gap: 10px;
	width: 100%;
	box-sizing: border-box;
	padding: 7px 10px;
	border: none;
	border-left: 3px solid transparent;
	border-radius: var(--theme--border-radius);
	background: transparent;
	color: inherit;
	font: inherit;
	text-align: left;
	cursor: pointer;
}

.row:hover {
	background: var(--theme--background-subdued);
}

.row.active {
	border-left-color: var(--theme--primary);
	background: color-mix(in srgb, var(--theme--primary) 12%, transparent);
}

.row:focus-visible {
	outline: 2px solid var(--theme--primary);
	outline-offset: -2px;
}


.row .v-icon {
	flex: none;
	margin-top: 2px;
}

.row-text {
	display: flex;
	flex: 1;
	flex-direction: column;
	gap: 1px;
	min-width: 0;
}

.row-main {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 8px;
}

.row-main strong {
	font-weight: 600;
}

.parts {
	display: flex;
	flex-direction: column;
	gap: 4px;
	min-width: 0;
}

.actor {
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

.types {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: var(--theme--foreground-subdued);
	font-size: 12px;
}

.pills {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
}

.pill {
	flex: none;
	padding: 0 8px;
	border-radius: 999px;
	font-size: 11px;
	font-weight: 600;
	line-height: 18px;
	background: color-mix(in srgb, var(--pill, var(--theme--primary)) 16%, transparent);
	color: var(--pill, var(--theme--primary));
}

.pill.added,
.pill.created {
	--pill: var(--theme--success);
}

.pill.removed,
.pill.deleted {
	--pill: var(--theme--danger);
}

.pill.rearranged {
	--pill: var(--theme--foreground-subdued);
}

.pill.reverted {
	--pill: var(--theme--warning);
}

.warning {
	color: var(--theme--warning);
}

.clamp {
	display: -webkit-box;
	overflow: hidden;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 2;
	line-clamp: 2;
	overflow-wrap: anywhere;
}

.time {
	flex: none;
	color: var(--theme--foreground-subdued);
	font-size: 12px;
	font-variant-numeric: tabular-nums;
}

.row-detail {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: var(--theme--foreground-subdued);
	font-size: 12px;
}





.seg {
	display: inline-flex;
	flex: none;
	border: var(--theme--border-width) solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	overflow: hidden;
}

.seg button {
	padding: 5px 14px;
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

.seg button:disabled {
	opacity: 0.4;
	cursor: not-allowed;
}

.load-more {
	margin-top: 10px;
}

.panel {
	background: var(--theme--background-subdued);
	border: var(--theme--border-width) solid var(--theme--border-color-subdued);
	border-radius: var(--theme--border-radius);
	padding: 16px;
}

.graph-pane {
	display: flex;
	flex: 1;
	flex-direction: column;
	min-height: 0;
	padding: 0;
	border: none;
	border-radius: 0;
	background: none;
}

.graph-pane > .empty {
	flex: 1;
}

.graph-pane > .muted {
	margin: var(--content-padding);
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
