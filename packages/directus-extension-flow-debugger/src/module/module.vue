<template>
	<private-view title="Flow Debugger">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="bug_report" />
			</v-button>
		</template>

		<template #actions>
			<template v-if="isAdmin">
				<v-button v-tooltip.bottom="'Refresh'" rounded icon secondary :loading="loadingList" @click="refresh">
					<v-icon name="refresh" />
				</v-button>
				<v-menu placement="bottom-end" show-arrow>
					<template #activator="{ toggle }">
						<v-button v-tooltip.bottom="'Export'" rounded icon secondary :disabled="!executions.length" @click="toggle">
							<v-icon name="download" />
						</v-button>
					</template>
					<v-list>
						<v-list-item clickable :disabled="!detail" @click="exportRun('json')">
							<v-list-item-content>This run as JSON</v-list-item-content>
						</v-list-item>
						<v-list-item clickable :disabled="!detail" @click="exportRun('csv')">
							<v-list-item-content>This run as CSV</v-list-item-content>
						</v-list-item>
						<v-divider />
						<v-list-item clickable @click="exportList('json')">
							<v-list-item-content>Run list as JSON</v-list-item-content>
						</v-list-item>
						<v-list-item clickable @click="exportList('csv')">
							<v-list-item-content>Run list as CSV</v-list-item-content>
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
					<div v-if="flowId" class="seg" role="group" aria-label="Which runs to show">
						<button type="button" :class="{ active: !failedOnly }" @click="failedOnly = false">All</button>
						<button type="button" :class="{ active: failedOnly }" @click="failedOnly = true">Failed</button>
					</div>
					<div v-if="flowId" class="nav-meta">
						<span>{{ executions.length }}{{ canLoadMore ? '+' : '' }} {{ executions.length === 1 ? 'run' : 'runs' }}</span>
						<v-icon v-tooltip.bottom="INFO_TEXT" class="info-icon" name="info" x-small />
					</div>
				</div>

				<p v-if="flowId && loadingList && !executions.length" class="muted note">Loading runs…</p>
				<p v-else-if="flowId && !executions.length" class="muted note">
					{{ failedOnly ? 'No failed runs. Everything worked.' : 'No runs yet. Runs show up here after a flow finishes.' }}
				</p>

				<template v-for="section in sections" :key="section.label">
					<h4 class="day">{{ section.label }}</h4>
					<button
						v-for="item in section.items"
						:key="item.id"
						type="button"
						class="row"
						:class="{ active: selectedId === item.id }"
						@click="selectRun(item.id)"
					>
						<v-icon :name="statusIcon(item.finalStatus)" :class="statusTone(item.finalStatus)" small />
						<span class="row-text">
							<span class="row-main">
								<span class="pills">
									<span class="pill" :class="item.finalStatus">{{ statusText(item.finalStatus) }}</span>
								</span>
								<span class="time" :title="absoluteTime(item.completedAt)">{{ short(item.completedAt) }}</span>
							</span>
							<strong v-if="!flowId" class="flow-name">{{ item.flowName || 'Deleted flow' }}</strong>
							<span class="detail-line">{{ rowDetail(item) }}</span>
						</span>
					</button>
				</template>

				<v-button v-if="canLoadMore" class="load-more" secondary small full-width :loading="loadingList" @click="loadMore">
					Load more
				</v-button>
			</div>
		</template>

		<div class="flow-debugger">
			<v-notice v-if="!isAdmin" type="danger" class="padded">Only administrators can use Flow Debugger.</v-notice>

			<template v-else>
				<p v-if="error" class="error-line padded">
					<v-icon name="error" small />
					{{ error }}
					<button type="button" class="link" @click="refresh">Try again</button>
				</p>

				<p v-if="loadingDetail && !detail" class="muted padded">Loading run…</p>
				<v-info v-else-if="!flowId" class="empty" icon="bug_report" title="Pick a flow" center>
					Choose a flow in the sidebar to see its runs.
				</v-info>
				<v-info v-else-if="!detail && !executions.length && !loadingList" class="empty" icon="bug_report" title="No runs yet" center>
					Runs show up here after the flow finishes.
				</v-info>
				<v-info v-else-if="!detail" class="empty" icon="bug_report" title="Pick a run" center>
					Choose a run in the sidebar to see what happened.
				</v-info>

				<template v-else>
					<header class="run-bar">
						<div class="run-title">
							<strong>{{ detail.flowName || 'Deleted flow' }}</strong>
							<span class="pill" :class="detail.finalStatus">{{ statusText(detail.finalStatus) }}</span>
							<span class="muted">{{ when(detail.completedAt) }} · {{ triggeredBy(detail) }}</span>
						</div>
						<div class="run-actions">
							<span v-tooltip.bottom="compareHint">
								<v-button
									small
									secondary
									:disabled="!compareCandidate || !detail.hasDetails"
									:loading="loadingComparison || findingCandidate"
									@click="compareWithLastSuccess"
								>
									Compare with last successful run
								</v-button>
							</span>
							<v-button
								v-if="detail.flowId && flowsById[detail.flowId]"
								v-tooltip.bottom="'Open this flow'"
								small
								secondary
								icon
								:to="flowRoute(detail.flowId)"
							>
								<v-icon name="open_in_new" small />
							</v-button>
						</div>
					</header>

					<p v-if="detail.finalStatus === 'reject' && failedStep" class="banner failure">
						<v-icon name="cancel" small />
						<span>Failed at ‘{{ stepLabel(failedStep) }}’: {{ describeStepError(failedStep.result) }}</span>
					</p>
					<p v-else-if="failedStep" class="banner muted">
						‘{{ stepLabel(failedStep) }}’ failed, but the flow carried on along its failure path.
					</p>
					<p v-if="!detail.hasDetails" class="banner muted">
						<template v-if="detailLoggingOff">
							Step details aren't saved for this flow. Open the flow and set Activity &amp; Logs to ‘All’ to see what each step did.
						</template>
						<template v-else>No step details were saved for this run.</template>
					</p>
					<p v-else-if="detail.graph?.addedSince" class="banner muted">
						The flow has {{ detail.graph.addedSince }} {{ detail.graph.addedSince === 1 ? 'step' : 'steps' }} added since this run, so
						{{ detail.graph.addedSince === 1 ? 'it is' : 'they are' }} left out. Steps and connections are drawn as they are today.
					</p>
					<p v-else-if="removedSteps.length" class="banner muted">
						{{ removedSteps.length }} {{ removedSteps.length === 1 ? 'step' : 'steps' }} of this run no longer
						{{ removedSteps.length === 1 ? 'exists' : 'exist' }} in the flow ({{ removedSteps.map(stepLabel).join(', ') }}).
					</p>

					<section class="graph-pane">
						<flow-graph
							:graph="drawnGraph"
							:states="states"
							:plain="!detail.hasDetails"
							:changed-ids="changedIds"
							@open="openCard"
						/>
					</section>
				</template>
			</template>
		</div>

		<v-drawer
			:model-value="Boolean(openedCard)"
			:title="openedTitle"
			:icon="statusIcon(openedStep?.status)"
			@update:model-value="openedCard = null"
			@cancel="openedCard = null"
		>
			<div v-if="openedCard" class="drawer-content">
				<template v-if="openedCard.kind === 'trigger'">
					<p class="muted">What started this run.</p>
					<div class="type-label">Trigger data</div>
					<pre>{{ pretty(detail.trigger) }}</pre>
					<div class="type-label">Accountability</div>
					<pre>{{ pretty(detail.accountability) }}</pre>
				</template>
				<p v-else-if="!openedStep" class="muted">This step did not run in this run.</p>
				<template v-else>
					<p>
						<span class="pill" :class="openedStep.status">{{ statusText(openedStep.status) }}</span>
					</p>
					<div class="type-label">Input</div>
					<pre>{{ pretty(openedStep.options) }}</pre>
					<div class="type-label">{{ openedStep.isError ? 'Error' : 'Output' }}</div>
					<pre>{{ pretty(openedStep.result) }}</pre>
				</template>
			</div>
		</v-drawer>

		<v-drawer
			:model-value="Boolean(comparison) && showComparison"
			title="Compared with the last successful run"
			icon="compare_arrows"
			@update:model-value="showComparison = false"
			@cancel="showComparison = false"
		>
			<div v-if="comparison" class="drawer-content">
				<p class="muted">The successful run from {{ when(comparison.baseline.completedAt) }}. Changed steps have a dashed outline in the flow.</p>
				<p v-if="!comparisonLines.length" class="muted">No differences. Both runs did the same thing.</p>
				<ul v-else class="diff-lines">
					<li v-for="line in comparisonLines" :key="line.key">
						<div class="diff-title">
							<v-icon :name="line.tone === 'danger' ? 'cancel' : 'change_circle'" :class="line.tone" small />
							<span>{{ line.text }}</span>
						</div>
						<details v-if="line.before !== undefined || line.after !== undefined">
							<summary>Show data</summary>
							<div class="type-label">Successful run</div>
							<pre>{{ pretty(line.before) }}</pre>
							<div class="type-label">This run</div>
							<pre>{{ pretty(line.after) }}</pre>
						</details>
					</li>
				</ul>
			</div>
		</v-drawer>
	</private-view>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useApi, useStores } from '@directus/extensions-sdk';
import FlowGraph from './flow-graph.vue';
import {
	formatExecutionDetailCsv,
	formatExecutionDetailJson,
	formatExecutionsCsv,
	formatExecutionsJson,
} from '../shared/reports.js';
import {
	describeComparison,
	describeStepError,
	findFailedStep,
	findPreviousSuccessfulRun,
	relativeTime,
	stepLabel,
	triggerLabel,
} from '../shared/run-text.js';

const LIMIT = 25;
const INFO_TEXT =
	"Shows finished runs only. Step details are saved only when a flow's Activity & Logs setting is ‘All’. Secrets are hidden by Directus.";

const api = useApi();
const { useUserStore } = useStores();
const userStore = useUserStore();
const isAdmin = computed(() => userStore.currentUser?.admin_access === true);

const flows = ref([]);
const flowId = ref(null);
const failedOnly = ref(false);
const executions = ref([]);
const page = ref(1);
const total = ref(null);
const lastPageSize = ref(0);
const selectedId = ref(null);
const detail = ref(null);
const compareCandidate = ref(null);
const comparison = ref(null);
const userNames = ref({});
const error = ref(null);
const loadingList = ref(false);
const loadingDetail = ref(false);
const loadingComparison = ref(false);
const findingCandidate = ref(false);
const now = ref(Date.now());

const flowsById = computed(() => Object.fromEntries(flows.value.map((flow) => [flow.id, flow])));
const flowItems = computed(() => flows.value.map((flow) => ({ text: flow.name, value: flow.id })));
const canLoadMore = computed(() =>
	total.value !== null ? executions.value.length < total.value : lastPageSize.value >= LIMIT,
);
const failedStep = computed(() => (detail.value ? findFailedStep(detail.value) : null));
const detailLoggingOff = computed(() => {
	const accountability = flowsById.value[detail.value?.flowId]?.accountability ?? detail.value?.flowAccountability;
	return accountability !== 'all';
});
const comparisonLines = computed(() => describeComparison(comparison.value));
const showComparison = ref(false);
const openedCard = ref(null);

// The run drawn on the flow as it is now. Steps that ran show what they were given, not what is saved today.
const stepsByCard = computed(() => {
	const map = new Map();
	for (const step of detail.value?.steps ?? []) if (step.operationId) map.set(step.operationId, step);
	return map;
});
const drawnGraph = computed(() => {
	const graph = detail.value?.graph;
	if (!graph) return null;
	return {
		...graph,
		panels: graph.panels.map((panel) => {
			const step = stepsByCard.value.get(panel.id);
			return step?.options ? { ...panel, options: step.options } : panel;
		}),
	};
});
const states = computed(() => Object.fromEntries([...stepsByCard.value].map(([id, step]) => [id, step.status])));
const removedSteps = computed(() => {
	const known = new Set((detail.value?.graph?.panels ?? []).map((panel) => panel.id));
	return (detail.value?.steps ?? []).filter((step) => step.operationId && !known.has(step.operationId));
});
const changedIds = computed(() => {
	if (!showComparison.value || !comparison.value) return [];
	const keys = new Set(comparisonLines.value.map((line) => line.key.replace(/^step-/, '')));
	return (detail.value?.steps ?? []).filter((step) => keys.has(step.key) && step.operationId).map((step) => step.operationId);
});
const openedStep = computed(() => (openedCard.value ? (stepsByCard.value.get(openedCard.value.id) ?? null) : null));
const openedTitle = computed(() => (openedCard.value?.kind === 'trigger' ? 'Trigger' : (openedCard.value?.name ?? '')));
const openCard = (panel) => (openedCard.value = panel);

const dayLabel = (value) => {
	const date = new Date(value);
	const today = new Date();
	const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - new Date(date.getFullYear(), date.getMonth(), date.getDate())) / 86400000);
	if (days === 0) return 'Today';
	if (days === 1) return 'Yesterday';
	return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};
const sections = computed(() => {
	const result = [];
	for (const item of executions.value) {
		const label = dayLabel(item.completedAt);
		const last = result[result.length - 1];
		if (last?.label === label) last.items.push(item);
		else result.push({ label, items: [item] });
	}
	return result;
});
const short = (value) => {
	const minutes = Math.round((now.value - Date.parse(value)) / 60000);
	if (minutes < 1) return 'now';
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h`;
	return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};
const absoluteTime = (value) => new Date(value).toLocaleString();
const rowDetail = (item) =>
	item.finalStatus === 'reject' && item.failedStepKey ? `Failed at ${item.failedStepKey} · ${triggeredBy(item)}` : triggeredBy(item);
const compareHint = computed(() => {
	if (!detail.value?.hasDetails) return 'This run has no step details to compare.';
	if (findingCandidate.value) return 'Looking for an earlier successful run…';
	if (!compareCandidate.value) return 'No earlier successful run of this flow was found.';
	return `Compare with the successful run from ${when(compareCandidate.value.completedAt)}`;
});

let clock = null;
let selectToken = 0;


// The chosen flow is remembered per user in Directus' own presets table (collection "flow-debugger" is only a
// label, nothing else reads it), so it comes back on the next visit and on other browsers.
const PRESET_KEY = 'flow-debugger';
let presetId = null;
let ready = false;

async function rememberedFlow() {
	const userId = userStore.currentUser?.id;
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
	const userId = userStore.currentUser?.id;
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

watch(flowId, (id) => {
	if (ready) rememberFlow(id ?? null);
});
watch([flowId, failedOnly], () => loadExecutions({ reset: true }));

onMounted(async () => {
	clock = setInterval(() => (now.value = Date.now()), 60000);
	if (!isAdmin.value) return;
	await loadFlows();
	const saved = await rememberedFlow();
	if (flows.value.some((flow) => flow.id === saved)) flowId.value = saved;
	ready = true;
	await loadExecutions({ reset: true });
});

onUnmounted(() => clearInterval(clock));

async function refresh() {
	await loadFlows();
	await loadExecutions({ reset: true });
}

async function loadFlows() {
	try {
		const { data } = await api.get('/flow-debugger/meta');
		flows.value = data.flows ?? [];
	} catch (err) {
		error.value = friendlyError(err);
	}
}

async function fetchRuns(params) {
	const { data } = await api.get('/flow-debugger/executions', { params: { limit: LIMIT, ...params } });
	return data;
}

async function loadExecutions({ reset = false } = {}) {
	if (!flowId.value) {
		executions.value = [];
		total.value = null;
		lastPageSize.value = 0;
		clearSelection();
		return;
	}
	loadingList.value = true;
	error.value = null;
	const nextPage = reset ? 1 : page.value + 1;
	try {
		const data = await fetchRuns({
			page: nextPage,
			flowId: flowId.value || undefined,
			status: failedOnly.value ? 'reject' : undefined,
		});
		const items = data.items ?? [];
		executions.value = reset ? items : [...executions.value, ...items];
		page.value = nextPage;
		total.value = data.total ?? null;
		lastPageSize.value = items.length;
		loadUserNames(items);
		if (reset) {
			const keep = executions.value.some((item) => item.id === selectedId.value);
			if (!keep && executions.value[0]) selectRun(executions.value[0].id);
			if (!executions.value.length) clearSelection();
		}
	} catch (err) {
		error.value = friendlyError(err);
	} finally {
		loadingList.value = false;
	}
}

function loadMore() {
	return loadExecutions();
}

function clearSelection() {
	showComparison.value = false;
	selectedId.value = null;
	detail.value = null;
	comparison.value = null;
	compareCandidate.value = null;
}

async function selectRun(id) {
	const token = ++selectToken;
	selectedId.value = id;
	showComparison.value = false;
	comparison.value = null;
	compareCandidate.value = null;
	loadingDetail.value = true;
	error.value = null;
	try {
		const { data } = await api.get(`/flow-debugger/executions/${id}`);
		if (token !== selectToken) return;
		detail.value = data;
		loadUserNames([data]);
		findCompareCandidate(data, token);
	} catch (err) {
		if (token !== selectToken) return;
		detail.value = null;
		error.value = friendlyError(err);
	} finally {
		if (token === selectToken) loadingDetail.value = false;
	}
}

async function findCompareCandidate(run, token) {
	if (!run.hasDetails || !run.flowId) return;
	const fromList = findPreviousSuccessfulRun(run, executions.value);
	if (fromList) {
		compareCandidate.value = fromList;
		return;
	}
	findingCandidate.value = true;
	try {
		const data = await fetchRuns({ page: 1, limit: 100, flowId: run.flowId, status: 'resolve' });
		if (token === selectToken) compareCandidate.value = findPreviousSuccessfulRun(run, data.items);
	} catch {
		// Leave the compare button disabled; the tooltip explains why.
	} finally {
		if (token === selectToken) findingCandidate.value = false;
	}
}

async function compareWithLastSuccess() {
	if (!compareCandidate.value || !detail.value) return;
	loadingComparison.value = true;
	error.value = null;
	try {
		const { data } = await api.get('/flow-debugger/compare', {
			params: { baselineId: compareCandidate.value.id, comparisonId: detail.value.id },
		});
		comparison.value = data;
		showComparison.value = true;
	} catch (err) {
		comparison.value = null;
		error.value = friendlyError(err);
	} finally {
		loadingComparison.value = false;
	}
}

async function loadUserNames(items) {
	const ids = [...new Set(items.map((item) => item.userId).filter((id) => id && !(id in userNames.value)))];
	if (!ids.length) return;
	try {
		const { data } = await api.get('/users', {
			params: {
				filter: JSON.stringify({ id: { _in: ids } }),
				fields: 'id,first_name,last_name,email',
				limit: -1,
			},
		});
		const next = { ...userNames.value };
		for (const user of data.data ?? []) {
			next[user.id] = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || user.email || 'a user';
		}
		userNames.value = next;
	} catch {
		// Fall back to "a user" labels.
	}
}

function triggeredBy(run) {
	if (run.userId) {
		if (run.userId === userStore.currentUser?.id) return 'by you';
		return `by ${userNames.value[run.userId] ?? 'a user'}`;
	}
	return triggerLabel(flowsById.value[run.flowId]?.trigger);
}

function when(value) {
	return relativeTime(value, now.value);
}

function statusIcon(status) {
	if (status === 'resolve') return 'check_circle';
	if (status === 'reject') return 'cancel';
	return 'help';
}

function statusTone(status) {
	if (status === 'resolve') return 'success';
	if (status === 'reject') return 'danger';
	return 'muted';
}

function statusText(status) {
	if (status === 'resolve') return 'Worked';
	if (status === 'reject') return 'Failed';
	return 'Result not recorded';
}

function flowRoute(id) {
	return `/settings/flows/${id}`;
}

function pretty(value) {
	if (value === undefined || value === null) return 'Nothing saved';
	return JSON.stringify(value, null, 2);
}

function friendlyError(err) {
	const message = err?.response?.data?.errors?.[0]?.message || err?.message;
	return message ? `Couldn't load runs: ${message}` : "Couldn't load runs.";
}

function download(filename, content, mime) {
	const blob = new Blob([content], { type: `${mime};charset=utf-8` });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	URL.revokeObjectURL(url);
}

function stamp() {
	return new Date().toISOString().replaceAll(':', '-');
}

function exportRun(format) {
	if (!detail.value) return;
	const name = `flow-execution-${detail.value.id}-${stamp()}`;
	if (format === 'json') download(`${name}.json`, formatExecutionDetailJson(detail.value), 'application/json');
	else download(`${name}.csv`, formatExecutionDetailCsv(detail.value), 'text/csv');
}

function exportList(format) {
	const list = { items: executions.value, page: page.value, limit: LIMIT, total: total.value };
	const name = `flow-executions-${stamp()}`;
	if (format === 'json') download(`${name}.json`, formatExecutionsJson(list), 'application/json');
	else download(`${name}.csv`, formatExecutionsCsv(list), 'text/csv');
}
</script>
<style scoped>
.flow-debugger {
	display: flex;
	flex-direction: column;
	height: calc(100vh - 64px);
	min-height: 420px;
}

.empty {
	flex: 1;
}

.padded {
	margin: var(--content-padding);
}

.header-icon {
	margin-right: 8px;
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

.seg {
	display: flex;
	border: var(--theme--border-width) solid var(--theme--border-color);
	border-radius: var(--theme--border-radius);
	overflow: hidden;
}

.seg button {
	flex: 1;
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

.row .v-icon {
	flex: none;
	margin-top: 2px;
}

.row-text {
	display: flex;
	flex: 1;
	flex-direction: column;
	gap: 3px;
	min-width: 0;
}

.row-main {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
}

.flow-name {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-weight: 600;
}

.detail-line {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: var(--theme--foreground-subdued);
	font-size: 12px;
}

.time {
	flex: none;
	color: var(--theme--foreground-subdued);
	font-size: 12px;
}

.pills {
	display: flex;
	gap: 4px;
}

.pill {
	flex: none;
	padding: 0 8px;
	border-radius: 999px;
	font-size: 11px;
	font-weight: 600;
	line-height: 18px;
	background: color-mix(in srgb, var(--pill, var(--theme--foreground-subdued)) 16%, transparent);
	color: var(--pill, var(--theme--foreground-subdued));
}

.pill.resolve {
	--pill: var(--theme--success);
}

.pill.reject {
	--pill: var(--theme--danger);
}

.load-more {
	margin-top: 10px;
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
	gap: 12px;
	margin-left: auto;
}

.banner {
	display: flex;
	align-items: center;
	gap: 8px;
	margin: 0;
	padding: 10px var(--content-padding);
	border-bottom: var(--theme--border-width) solid var(--theme--border-color-subdued);
	font-size: 14px;
}

.banner.failure {
	background: color-mix(in srgb, var(--theme--danger) 10%, transparent);
	color: var(--theme--danger);
}

.graph-pane {
	display: flex;
	flex: 1;
	flex-direction: column;
	min-height: 0;
}

.drawer-content {
	padding: var(--content-padding);
}

.type-label {
	margin: 16px 0 6px;
	color: var(--theme--foreground-subdued);
	font-size: 12px;
	font-weight: 600;
	text-transform: uppercase;
}

pre {
	margin: 0;
	padding: 12px;
	overflow: auto;
	max-height: 360px;
	border-radius: var(--theme--border-radius);
	background: var(--theme--background-subdued);
	font-family: var(--theme--fonts--monospace--font-family);
	font-size: 13px;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}

.diff-lines {
	display: flex;
	flex-direction: column;
	gap: 14px;
	margin: 12px 0 0;
	padding: 0;
	list-style: none;
}

.diff-title {
	display: flex;
	align-items: center;
	gap: 8px;
}

.error-line {
	display: flex;
	align-items: center;
	gap: 8px;
	color: var(--theme--danger);
}

.link {
	padding: 0;
	border: none;
	background: none;
	color: var(--theme--primary);
	font: inherit;
	text-decoration: underline;
	cursor: pointer;
}

.success {
	color: var(--theme--success);
}

.danger {
	color: var(--theme--danger);
}

.warning {
	color: var(--theme--warning);
}

.muted {
	color: var(--theme--foreground-subdued);
}
</style>
