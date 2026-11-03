<template>
	<private-view title="Activity Cleanup">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="cleaning_services" />
			</v-button>
		</template>

		<template #actions>
			<template v-if="isAdmin">
				<v-menu v-if="overview" show-arrow placement="bottom-end">
					<template #activator="{ toggle }">
						<v-button v-tooltip.bottom="'Export'" rounded icon secondary @click="toggle">
							<v-icon name="download" />
						</v-button>
					</template>
					<v-list>
						<v-list-item clickable @click="exportReport('csv')">
							<v-list-item-icon><v-icon name="table_view" /></v-list-item-icon>
							<v-list-item-content>Export as CSV</v-list-item-content>
						</v-list-item>
						<v-list-item clickable @click="exportReport('json')">
							<v-list-item-icon><v-icon name="data_object" /></v-list-item-icon>
							<v-list-item-content>Export as JSON</v-list-item-content>
						</v-list-item>
					</v-list>
				</v-menu>
				<v-button v-tooltip.bottom="'Refresh'" rounded icon :loading="loading" @click="loadOverview">
					<v-icon name="refresh" />
				</v-button>
			</template>
		</template>

		<div class="cleanup-manager">
			<v-notice v-if="!isAdmin" type="danger">Only administrators can use Activity Cleanup.</v-notice>

			<div v-else-if="!overview && loading" class="state">
				<v-progress-circular indeterminate />
				<p class="muted">Counting history records…</p>
			</div>

			<v-notice v-else-if="!overview && error" type="danger">Couldn't load history: {{ error }} Try "Refresh".</v-notice>

			<template v-else-if="overview">
				<v-notice v-if="error" type="danger" class="notice">{{ error }}</v-notice>

				<section class="status panel">
					<p class="status-line">
						<v-icon :name="status.on ? 'check_circle' : 'warning'" :class="status.on ? 'success-text' : 'warning-text'" />
						<span>
							{{ status.usage }} Automatic cleanup:
							<strong :class="status.on ? 'success-text' : 'warning-text'">{{ status.cleanup }}</strong>
						</span>
					</p>
					<p v-if="tip" class="tip muted">
						<v-icon name="lightbulb" small />
						{{ tip }}
					</p>
					<details v-if="!status.on" class="how-to">
						<summary>How to turn it on</summary>
						<p class="muted small">Add these lines to your Directus environment (for example <code>.env</code>) and restart Directus:</p>
						<pre class="env">{{ enableLines }}</pre>
						<p class="muted small">Directus then deletes older history automatically every night.</p>
					</details>
				</section>

				<v-notice v-if="result" type="success" class="notice">{{ result }}</v-notice>

				<section class="panel">
					<h2 class="type-title">History by collection</h2>
					<table v-if="collections.length" class="table">
						<thead>
							<tr>
								<th>Collection</th>
								<th class="num">History records</th>
								<th>Oldest</th>
								<th />
							</tr>
						</thead>
						<tbody>
							<tr v-for="item in collections" :key="item.collection">
								<td>
									{{ nameOf(item.collection) }}
									<span v-if="!item.exists" class="chip">deleted collection</span>
								</td>
								<td class="num" :title="`${formatCount(item.activity)} activity · ${formatCount(item.revisions)} revisions`">
									{{ formatCount(historyRecords(item)) }}
								</td>
								<td class="muted" :title="item.oldest ? new Date(item.oldest).toLocaleString() : ''">{{ timeAgo(item.oldest) }}</td>
								<td class="right">
									<v-button v-if="canClean(item)" x-small secondary @click="openCleanup(item)">Clean up</v-button>
								</td>
							</tr>
						</tbody>
					</table>
					<p v-else class="empty">No history recorded yet. Nothing to clean up.</p>
				</section>

				<details class="panel settings">
					<summary class="type-title">Retention settings</summary>
					<p class="muted small meta">Built-in cleanup settings, read from the server environment.</p>
					<table class="table">
						<thead>
							<tr><th>Variable</th><th>Value</th><th>Effect</th></tr>
						</thead>
						<tbody>
							<tr v-for="row in retentionRows" :key="row.key">
								<td class="mono">{{ row.key }}</td>
								<td class="mono">
									{{ row.value }}
									<span v-if="row.isDefault" class="muted small">(default)</span>
								</td>
								<td class="muted">{{ row.effect }}</td>
							</tr>
						</tbody>
					</table>
					<ul v-if="retention.notes.length" class="notes muted small">
						<li v-for="note in retention.notes" :key="note">{{ note }}</li>
					</ul>
				</details>
			</template>
		</div>

		<v-dialog v-model="dialogOpen" :persistent="purging" @esc="!purging && (dialogOpen = false)">
			<v-card>
				<v-card-title>Delete history for {{ target ? nameOf(target.collection) : '' }}</v-card-title>
				<v-card-text>
					<v-select v-model="age" :items="AGE_OPTIONS" item-text="text" item-value="value" :disabled="purging" />
					<p class="dialog-line">
						<template v-if="previewing">Counting records…</template>
						<span v-else-if="previewError" class="danger-text">{{ previewError }}</span>
						<template v-else-if="preview">
							<template v-if="toDelete">This will delete <strong>{{ formatCount(toDelete) }}</strong> {{ toDelete === 1 ? 'record' : 'records' }}. This can't be undone.</template>
							<template v-else>Nothing to delete for this period.</template>
						</template>
					</p>
					<p v-if="preview?.preview.protectedActivity" class="muted small">
						{{ formatCount(preview.preview.protectedActivity) }} records linked to content versions are kept.
					</p>
				</v-card-text>
				<v-card-actions>
					<v-button secondary :disabled="purging" @click="dialogOpen = false">Cancel</v-button>
					<v-button kind="danger" :disabled="!toDelete || previewing" :loading="purging" @click="runPurge">
						Delete {{ formatCount(toDelete) }} {{ toDelete === 1 ? 'record' : 'records' }}
					</v-button>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</private-view>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useApi, useStores } from '@directus/extensions-sdk';
import { formatCount, formatOverviewCsv, formatOverviewJson } from '../shared/reports.js';
import { AGE_OPTIONS, cutoffFor, enableEnv, historyRecords, statusLine, timeAgo, topTip } from '../shared/summary.js';

const PURGE_URL = '/activity-cleanup-manager/purge';

const api = useApi();
const { useUserStore, useCollectionsStore } = useStores();
const userStore = useUserStore();
const collectionsStore = useCollectionsStore();
const isAdmin = computed(() => userStore.currentUser?.admin_access === true);

const overview = ref(null);
const loading = ref(false);
const error = ref(null);
const result = ref(null);

const dialogOpen = ref(false);
const target = ref(null);
const age = ref('90d');
const cutoff = ref(null);
const preview = ref(null);
const previewing = ref(false);
const previewError = ref(null);
const purging = ref(false);
let previewToken = 0;

const insights = computed(() => overview.value?.insights);
const retention = computed(() => overview.value?.retention);
const status = computed(() => statusLine(overview.value));
const tip = computed(() => topTip(insights.value, nameOf));
const collections = computed(() => insights.value?.byCollection.filter((item) => historyRecords(item) > 0) ?? []);
const enableLines = computed(() =>
	Object.entries(enableEnv(overview.value))
		.map(([key, value]) => `${key}=${value}`)
		.join('\n'),
);
const toDelete = computed(() => (preview.value ? historyRecords(preview.value.preview) : 0));

const retentionRows = computed(() => {
	const r = retention.value;
	const effects = {
		RETENTION_ENABLED: r.enabled ? 'Enabled' : 'Nothing is deleted automatically',
		RETENTION_SCHEDULE: r.scheduleValid ? 'When the cleanup job runs (cron)' : 'Invalid cron expression',
		RETENTION_BATCH: 'Rows deleted per statement',
		ACTIVITY_RETENTION: r.effective.activity ? `Activity (except flow runs) kept ${r.effective.activity}` : 'Activity never expires',
		REVISIONS_RETENTION: r.effective.revisions
			? `Revisions effectively kept ${r.effective.revisions}${r.tasks.revisions ? '' : ' (removed with their activity)'}`
			: 'Revisions never expire',
		FLOW_LOGS_RETENTION: r.effective.flowLogs ? `Flow run logs kept ${r.effective.flowLogs}` : 'Flow logs never expire',
	};
	return Object.keys(r.values).map((key) => ({ key, value: String(r.values[key]), isDefault: r.defaults[key], effect: effects[key] }));
});

watch(age, () => {
	if (dialogOpen.value) loadPreview();
});

onMounted(() => {
	if (isAdmin.value) loadOverview();
});

async function loadOverview() {
	loading.value = true;
	error.value = null;

	try {
		const { data } = await api.get('/activity-cleanup-manager/overview');
		overview.value = data;
	} catch (err) {
		error.value = readError(err);
	} finally {
		loading.value = false;
	}
}

function canClean(item) {
	return item.activity > 0 && item.collection !== '(none)';
}

function openCleanup(item) {
	target.value = item;
	result.value = null;
	dialogOpen.value = true;
	if (age.value === '90d') loadPreview();
	else age.value = '90d';
}

// Dry run for the chosen period. The cut-off is fixed here and reused for the real delete.
async function loadPreview() {
	const token = ++previewToken;
	const olderThan = cutoffFor(age.value);
	previewing.value = true;
	previewError.value = null;
	preview.value = null;

	try {
		const { data } = await api.post(PURGE_URL, { collection: target.value.collection, olderThan, dryRun: true });
		if (token !== previewToken) return;
		preview.value = data;
		cutoff.value = olderThan;
	} catch (err) {
		if (token === previewToken) previewError.value = readError(err);
	} finally {
		if (token === previewToken) previewing.value = false;
	}
}

async function runPurge() {
	const collection = target.value.collection;
	purging.value = true;
	previewError.value = null;

	try {
		const { data } = await api.post(PURGE_URL, { collection, olderThan: cutoff.value, dryRun: false, confirm: collection });
		result.value = `Deleted ${formatCount(historyRecords(data.deleted))} history records from ${nameOf(collection)}.`;
		dialogOpen.value = false;
		await loadOverview();
	} catch (err) {
		previewError.value = readError(err);
	} finally {
		purging.value = false;
	}
}

function nameOf(collection) {
	const name = collectionsStore.getCollection(collection)?.name;
	if (name) return name;
	if (collection === '(none)') return 'No collection';
	return collection
		.replace(/^directus_/, '')
		.split('_')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

function readError(err) {
	return err?.response?.data?.errors?.[0]?.message ?? err.message;
}

function exportReport(format) {
	const content = format === 'json' ? formatOverviewJson(overview.value) : formatOverviewCsv(overview.value);
	const blob = new Blob([content], { type: `${format === 'json' ? 'application/json' : 'text/csv'};charset=utf-8` });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = `activity-cleanup-${new Date().toISOString().replaceAll(':', '-')}.${format}`;
	anchor.click();
	URL.revokeObjectURL(url);
}
</script>

<style scoped>
.cleanup-manager {
	padding: var(--content-padding);
	padding-bottom: var(--content-padding-bottom);
	max-width: 1000px;
}

.state {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 16px;
	padding: 80px 0;
}

.notice {
	margin-bottom: 16px;
}

.panel {
	background: var(--theme--background-subdued);
	border: var(--theme--border-width) solid var(--theme--border-color-subdued);
	border-radius: var(--theme--border-radius);
	padding: 20px;
	margin-bottom: 20px;
}

.status-line {
	display: flex;
	align-items: center;
	gap: 10px;
	font-size: 16px;
}

.tip {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-top: 8px;
}

.how-to {
	margin-top: 12px;
}

.how-to summary,
.settings summary {
	cursor: pointer;
	color: var(--theme--primary);
}

.settings summary {
	color: var(--theme--foreground);
}

.how-to p {
	margin: 8px 0;
}

.env {
	margin: 0;
	padding: 8px 12px;
	border-radius: var(--theme--border-radius);
	background: var(--theme--background-normal);
	font-family: var(--theme--fonts--monospace--font-family), monospace;
	white-space: pre-wrap;
}

.type-title {
	margin-bottom: 12px;
}

.settings .meta {
	margin: 12px 0;
}

.table {
	width: 100%;
	border-collapse: collapse;
}

.table th,
.table td {
	text-align: left;
	padding: 8px;
	border-bottom: var(--theme--border-width) solid var(--theme--border-color-subdued);
	vertical-align: middle;
}

.table th {
	color: var(--theme--foreground-subdued);
	font-weight: 600;
}

.table .num {
	text-align: right;
	white-space: nowrap;
}

.right {
	text-align: right;
}

.chip {
	margin-left: 6px;
	padding: 1px 8px;
	border-radius: 999px;
	font-size: 12px;
	color: var(--theme--warning);
	background: var(--theme--background-normal);
}

.empty {
	padding: 24px 0;
	text-align: center;
	color: var(--theme--foreground-subdued);
}

.notes {
	margin: 12px 0 0;
	padding-left: 20px;
}

.dialog-line {
	margin: 16px 0 8px;
}

.success-text { color: var(--theme--success); }
.warning-text { color: var(--theme--warning); }
.danger-text { color: var(--theme--danger); }
.muted { color: var(--theme--foreground-subdued); }
.small { font-size: 13px; }
.mono { font-family: var(--theme--fonts--monospace--font-family), monospace; }
.header-icon { margin-right: 8px; }
</style>
