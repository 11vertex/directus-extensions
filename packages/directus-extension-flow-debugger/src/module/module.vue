<template>
	<private-view title="Flow Debugger">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="bug_report" />
			</v-button>
		</template>

		<template #actions>
			<template v-if="isAdmin">
				<v-button
					v-tooltip.bottom="'Refresh'"
					rounded
					icon
					secondary
					:loading="loadingList"
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
							:disabled="!executions.length"
							@click="toggle"
						>
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

		<div class="flow-debugger">
			<v-notice v-if="!isAdmin" type="danger">
				Only administrators can use Flow Debugger.
			</v-notice>

			<template v-else>
				<div class="toolbar">
					<v-select
						v-model="flowId"
						class="flow-select"
						:items="flowItems"
						item-text="text"
						item-value="value"
						show-deselect
						placeholder="All flows"
					/>
					<div class="chips" role="group" aria-label="Which runs to show">
						<button type="button" class="chip" :class="{ active: !failedOnly }" @click="failedOnly = false">
							All
						</button>
						<button type="button" class="chip" :class="{ active: failedOnly }" @click="failedOnly = true">
							Failed only
						</button>
					</div>
					<v-icon v-tooltip.bottom="INFO_TEXT" class="info-icon" name="info" small />
				</div>

				<p v-if="error" class="error-line">
					<v-icon name="error" small />
					{{ error }}
					<button type="button" class="link" @click="refresh">Try again</button>
				</p>

				<div class="workspace">
					<section class="panel run-list">
						<p class="legend">
							<span><v-icon name="check_circle" x-small class="success" /> worked</span>
							<span><v-icon name="cancel" x-small class="danger" /> failed</span>
							<span><v-icon name="help" x-small class="muted" /> not recorded</span>
						</p>

						<p v-if="loadingList && !executions.length" class="muted">Loading runs…</p>
						<p v-else-if="!executions.length" class="muted">
							{{
								failedOnly
									? 'No failed runs. Everything worked.'
									: 'No runs yet. Runs show up here after a flow finishes.'
							}}
						</p>

						<button
							v-for="item in executions"
							:key="item.id"
							type="button"
							class="run-row"
							:class="{ active: selectedId === item.id }"
							@click="selectRun(item.id)"
						>
							<v-icon :name="statusIcon(item.finalStatus)" :class="statusTone(item.finalStatus)" />
							<span class="run-text">
								<strong>{{ item.flowName || 'Deleted flow' }}</strong>
								<span class="muted">{{ when(item.completedAt) }} · {{ triggeredBy(item) }}</span>
							</span>
						</button>

						<v-button
							v-if="canLoadMore"
							class="load-more"
							secondary
							small
							full-width
							:loading="loadingList"
							@click="loadMore"
						>
							Load more
						</v-button>
					</section>

					<section class="panel run-detail">
						<p v-if="loadingDetail" class="muted">Loading run…</p>
						<p v-else-if="!detail" class="muted">Pick a run on the left to see what happened.</p>

						<template v-else>
							<header class="detail-header">
								<div>
									<h2>{{ detail.flowName || 'Deleted flow' }}</h2>
									<p class="muted">
										{{ statusText(detail.finalStatus) }} · {{ when(detail.completedAt) }} ·
										{{ triggeredBy(detail) }}
									</p>
								</div>
								<div class="detail-actions">
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

							<p v-if="detail.finalStatus === 'reject' && failedStep" class="failure">
								<v-icon name="cancel" small />
								<span>
									Failed at step ‘{{ stepLabel(failedStep) }}’:
									{{ describeStepError(failedStep.result) }}
								</span>
							</p>
							<p v-else-if="failedStep" class="muted">
								Step ‘{{ stepLabel(failedStep) }}’ failed, but the flow carried on along its
								failure path.
							</p>

							<p v-if="!detail.hasDetails" class="hint">
								<template v-if="detailLoggingOff">
									Step details aren't saved for this flow. Open the flow and set Activity & Logs
									to ‘All’.
									<router-link v-if="flowsById[detail.flowId]" :to="flowRoute(detail.flowId)">
										Open flow
									</router-link>
								</template>
								<template v-else>No step details were saved for this run.</template>
							</p>

							<ol v-else class="steps">
								<li v-for="step in detail.steps" :key="`${step.index}-${step.key}`" class="step">
									<div class="step-title">
										<v-icon :name="statusIcon(step.status)" :class="statusTone(step.status)" small />
										<strong>{{ stepLabel(step) }}</strong>
									</div>
									<details :open="step === failedStep">
										<summary>Show data</summary>
										<div class="data-grid">
											<div>
												<div class="type-label">Input</div>
												<pre>{{ pretty(step.options) }}</pre>
											</div>
											<div>
												<div class="type-label">{{ step.isError ? 'Error' : 'Output' }}</div>
												<pre>{{ pretty(step.result) }}</pre>
											</div>
										</div>
									</details>
								</li>
							</ol>

							<section v-if="comparison" class="comparison">
								<h3>
									Compared with the successful run from
									{{ when(comparison.baseline.completedAt) }}
								</h3>
								<p v-if="!comparisonLines.length" class="muted">
									No differences. Both runs did the same thing.
								</p>
								<ul v-else class="diff-lines">
									<li v-for="line in comparisonLines" :key="line.key">
										<div class="step-title">
											<v-icon :name="line.tone === 'danger' ? 'cancel' : 'change_circle'" :class="line.tone" small />
											<span>{{ line.text }}</span>
										</div>
										<details v-if="line.before !== undefined || line.after !== undefined">
											<summary>Show data</summary>
											<div class="data-grid">
												<div>
													<div class="type-label">Successful run</div>
													<pre>{{ pretty(line.before) }}</pre>
												</div>
												<div>
													<div class="type-label">This run</div>
													<pre>{{ pretty(line.after) }}</pre>
												</div>
											</div>
										</details>
									</li>
								</ul>
							</section>

							<details class="technical">
								<summary>Technical details</summary>
								<dl>
									<dt>Run id</dt>
									<dd>{{ detail.id }}</dd>
									<dt>Flow id</dt>
									<dd>{{ detail.flowId || '—' }}</dd>
									<dt>User id</dt>
									<dd>{{ detail.userId || '—' }}</dd>
								</dl>
								<div class="type-label">Trigger data</div>
								<pre>{{ pretty(detail.trigger) }}</pre>
								<div class="type-label">Accountability</div>
								<pre>{{ pretty(detail.accountability) }}</pre>
								<div class="type-label">Environment (redacted)</div>
								<pre>{{ pretty(detail.env) }}</pre>
							</details>
						</template>
					</section>
				</div>
			</template>
		</div>
	</private-view>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useApi, useStores } from '@directus/extensions-sdk';
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
const compareHint = computed(() => {
	if (!detail.value?.hasDetails) return 'This run has no step details to compare.';
	if (findingCandidate.value) return 'Looking for an earlier successful run…';
	if (!compareCandidate.value) return 'No earlier successful run of this flow was found.';
	return `Compare with the successful run from ${when(compareCandidate.value.completedAt)}`;
});

let clock = null;
let selectToken = 0;

watch([flowId, failedOnly], () => loadExecutions({ reset: true }));

onMounted(async () => {
	clock = setInterval(() => (now.value = Date.now()), 60000);
	if (!isAdmin.value) return;
	await loadFlows();
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
	selectedId.value = null;
	detail.value = null;
	comparison.value = null;
	compareCandidate.value = null;
}

async function selectRun(id) {
	const token = ++selectToken;
	selectedId.value = id;
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
	flex-wrap: wrap;
	margin-bottom: 16px;
}

.flow-select {
	width: 280px;
	max-width: 100%;
}

.chips {
	display: flex;
	gap: 6px;
}

.chip {
	padding: 6px 14px;
	border-radius: 999px;
	border: var(--theme--border-width) solid var(--theme--border-color-subdued);
	background: var(--theme--background-subdued);
	color: var(--theme--foreground);
	cursor: pointer;
	font: inherit;
}

.chip.active {
	border-color: var(--theme--primary);
	background: var(--theme--primary);
	color: var(--theme--foreground-inverted);
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
	grid-template-columns: minmax(260px, 340px) 1fr;
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

.legend {
	display: flex;
	gap: 12px;
	margin: 0 0 12px;
	font-size: 12px;
	color: var(--theme--foreground-subdued);
}

.run-row {
	display: flex;
	align-items: center;
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

.run-row.active {
	border-color: var(--theme--primary);
}

.run-text {
	display: flex;
	flex-direction: column;
	min-width: 0;
}

.run-text strong,
.run-text span {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.run-text span {
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
	align-items: center;
}

.failure {
	display: flex;
	gap: 8px;
	align-items: flex-start;
	padding: 12px;
	margin: 0 0 16px;
	border-radius: var(--theme--border-radius);
	border: var(--theme--border-width) solid var(--theme--danger);
	color: var(--theme--danger);
}

.hint {
	margin: 0 0 16px;
}

.steps,
.diff-lines {
	list-style: none;
	margin: 0;
	padding: 0;
}

.step,
.diff-lines li {
	padding: 10px 12px;
	margin-bottom: 6px;
	border-radius: var(--theme--border-radius);
	background: var(--theme--background);
	border: var(--theme--border-width) solid var(--theme--border-color-subdued);
}

.step-title {
	display: flex;
	align-items: center;
	gap: 8px;
}

.data-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 12px;
	margin-top: 8px;
}

@media (max-width: 720px) {
	.data-grid {
		grid-template-columns: 1fr;
	}
}

.comparison {
	margin-top: 20px;
}

.comparison h3 {
	margin: 0 0 10px;
	font-size: 15px;
	font-weight: 600;
}

.technical {
	margin-top: 20px;
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

details summary {
	cursor: pointer;
	color: var(--theme--foreground-subdued);
	font-size: 13px;
	margin-top: 6px;
}

pre {
	font-family: var(--theme--fonts--monospace--font-family), monospace;
	font-size: 12px;
	background: var(--theme--background-subdued);
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

.warning {
	color: var(--theme--warning);
}

.muted {
	color: var(--theme--foreground-subdued);
}
</style>
