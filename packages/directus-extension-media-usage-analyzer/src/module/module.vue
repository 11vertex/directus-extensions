<template>
	<private-view title="Media Usage Analyzer">
		<template #title-outer:prepend>
			<v-button class="header-icon" rounded disabled icon secondary>
				<v-icon name="perm_media" />
			</v-button>
		</template>

		<template #actions>
			<template v-if="isAdmin">
				<v-checkbox v-model="scanContent" class="content-toggle" label="Also check links inside text fields (slower)" />
				<v-menu v-if="report" show-arrow placement="bottom-end">
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
				<v-button v-tooltip.bottom="'Scan again'" rounded icon :loading="loading" @click="runScan">
					<v-icon name="refresh" />
				</v-button>
			</template>
		</template>

		<div class="media-usage-analyzer">
			<v-notice v-if="!isAdmin" type="danger">Only administrators can use Media Usage Analyzer.</v-notice>

			<div v-else-if="!report && loading" class="state">
				<v-progress-circular indeterminate />
				<p class="muted">Scanning your files… this can take a moment on large libraries.</p>
			</div>

			<v-notice v-else-if="!report && error" type="danger">Couldn't scan your files: {{ error }} Try "Scan again".</v-notice>

			<template v-else-if="report">
				<v-notice v-if="error" type="danger" class="notice">{{ error }}</v-notice>

				<section class="cards">
					<button
						v-for="card in cards"
						:key="card.id"
						type="button"
						class="card"
						:class="[card.tone, { active: active === card.id, focus: focus === card.id }]"
						@click="active = card.id"
					>
						<span class="card-label">
							<v-icon :name="card.icon" small />
							{{ card.label }}
							<span v-if="focus === card.id" class="card-badge">Start here</span>
						</span>
						<span class="card-value">{{ card.value }}</span>
						<span class="muted small">{{ card.detail }}</span>
					</button>
				</section>

				<p class="meta muted small">
					Scanned {{ timeAgo(report.generatedAt) }}{{ report.summary.contentScanned ? ', including links inside text fields' : '' }}.
					<span v-if="report.warnings.length" class="warning-text">Some fields couldn't be checked, so results may be incomplete.</span>
				</p>
				<details v-if="report.warnings.length" class="technical">
					<summary class="muted small">Technical details</summary>
					<ul class="muted small">
						<li v-for="warning in report.warnings" :key="warning">{{ warning }}</li>
					</ul>
				</details>

				<section class="panel">
					<h2 class="type-title">{{ activeCard.title }}</h2>

					<template v-if="active === 'unused'">
						<p class="hint muted small">
							Not used in any file field{{ report.summary.contentScanned ? ' or text field' : '' }}. Each file is checked again right before it is deleted.
						</p>
						<v-notice v-if="deleteResult" :type="deleteResult.tone" class="notice">{{ deleteResult.text }}</v-notice>
						<template v-if="report.unusedFiles.length">
							<div class="toolbar">
								<v-checkbox
									:model-value="allSelected"
									:indeterminate="selected.size > 0 && !allSelected"
									label="Select all"
									@update:model-value="selectAll"
								/>
								<span class="muted small">{{ selected.size ? `${filesLabel(selected.size, selectedBytes)} selected` : '' }}</span>
								<v-button kind="danger" small :disabled="selected.size === 0" @click="deleteOpen = true">
									<v-icon name="delete" left small />
									Delete selected
								</v-button>
							</div>
							<file-list :files="report.unusedFiles" selectable :selected="selected" @toggle="toggle" />
							<p v-if="report.unusedTruncated" class="muted small more">
								Showing the {{ formatNumber(report.unusedFiles.length) }} largest. Delete some and scan again to see the rest.
							</p>
						</template>
						<p v-else class="empty">Every file is in use. Nothing to clean up.</p>
					</template>

					<template v-else-if="active === 'duplicates'">
						<p class="hint muted small">
							{{ report.duplicates.heuristic === 'checksum' ? 'Files with identical content.' : 'Files with the same name, size and type.' }}
							Point your items at one copy; the other copies then show up as unused.
						</p>
						<article v-for="group in report.duplicates.groups" :key="group.key" class="group">
							<h3 class="group-title">
								{{ group.filename }}
								<span class="muted small">{{ group.count }} copies · {{ formatBytes(group.wastedBytes) }} could be freed</span>
							</h3>
							<file-list :files="group.files" :detail="usedLabel" />
						</article>
						<p v-if="report.duplicates.groups.length === 0" class="empty">No duplicate uploads found.</p>
					</template>

					<template v-else-if="active === 'broken'">
						<p class="hint muted small">These fields point to files that were deleted. Open the items and pick a new file or clear the field.</p>
						<ul v-if="report.broken.length" class="rows">
							<li v-for="entry in report.broken" :key="`${entry.source}:${entry.fileId}`" class="row" :title="`Missing file: ${entry.fileId}`">
								<v-icon name="link_off" class="danger-text" />
								<span class="name">
									<span>{{ whereLabel(entry) }}</span>
									<span class="muted small">
										{{ formatNumber(entry.count) }} {{ entry.count === 1 ? 'item points' : 'items point' }} to a missing file
									</span>
								</span>
								<router-link v-if="!entry.usageCollection.startsWith('directus_')" class="open" :to="`/content/${entry.usageCollection}`">
									Open
								</router-link>
							</li>
						</ul>
						<p v-else class="empty">No broken links. Every file reference works.</p>
					</template>

					<template v-else-if="active === 'large'">
						<p class="hint muted small">Images wider or taller than 4000 px, or bigger than 10 MB. Smaller versions load faster.</p>
						<file-list v-if="report.images.large.length" :files="report.images.large" :detail="imageDetail" />
						<p v-else class="empty">No large images.</p>
					</template>

					<template v-else>
						<p class="hint muted small">Your largest files.</p>
						<file-list v-if="report.largestFiles.length" :files="report.largestFiles" :detail="usedLabel" />
						<p v-else class="empty">No files uploaded yet.</p>
					</template>
				</section>

				<section v-if="kinds.length" class="panel">
					<h2 class="type-title">Storage by type</h2>
					<ul class="bars">
						<li v-for="row in kinds" :key="row.label" class="bar-row">
							<span>{{ row.label }}</span>
							<span class="bar-track"><span class="bar" :style="{ width: share(row.bytes) }" /></span>
							<span class="muted small">{{ formatBytes(row.bytes) }} · {{ formatNumber(row.files) }} files</span>
						</li>
					</ul>
				</section>
			</template>
		</div>

		<v-dialog v-model="deleteOpen" :persistent="deleting" @esc="!deleting && (deleteOpen = false)">
			<v-card>
				<v-card-title>Delete {{ filesLabel(selected.size, selectedBytes) }}?</v-card-title>
				<v-card-text>
					This can't be undone. Files that are in use by now are skipped automatically.
					Links from outside Directus (other websites, custom code) can't be detected.
				</v-card-text>
				<v-card-actions>
					<v-button secondary :disabled="deleting" @click="deleteOpen = false">Cancel</v-button>
					<v-button kind="danger" :loading="deleting" @click="confirmDelete">
						Delete {{ formatNumber(selected.size) }} {{ selected.size === 1 ? 'file' : 'files' }}
					</v-button>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</private-view>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useApi, useStores } from '@directus/extensions-sdk';
import FileList from './components/file-list.vue';
import { formatBytes, formatNumber, timeAgo } from '../shared/format.js';
import { deletionResultText, filesLabel, focusCard, storageByKind } from '../shared/overview.js';
import { formatReportCsv, formatReportJson } from '../shared/reports.js';

const DELETE_URL = '/media-usage-analyzer/delete';

const api = useApi();
const { useUserStore, useCollectionsStore, useFieldsStore } = useStores();
const userStore = useUserStore();
const collectionsStore = useCollectionsStore();
const fieldsStore = useFieldsStore();
const isAdmin = computed(() => userStore.currentUser?.admin_access === true);

const report = ref(null);
const loading = ref(false);
const error = ref(null);
const scanContent = ref(false);
const active = ref('unused');
const selected = ref(new Set());
const deleteOpen = ref(false);
const deleting = ref(false);
const deleteResult = ref(null);

const summary = computed(() => report.value?.summary ?? {});
const focus = computed(() => (report.value ? focusCard(summary.value) : null));
const unusedIds = computed(() => new Set(report.value?.unusedFiles.map((file) => file.id) ?? []));
const kinds = computed(() => storageByKind(report.value?.storage.byCategory));

const cards = computed(() => {
	const s = summary.value;
	return [
		{ id: 'storage', icon: 'cloud', label: 'Storage used', title: 'Largest files', value: formatBytes(s.totalBytes), detail: `in ${formatNumber(s.files)} files` },
		{ id: 'unused', icon: 'delete_sweep', label: 'Unused files', title: 'Unused files', value: formatNumber(s.unusedFiles), detail: formatBytes(s.unusedBytes), tone: s.unusedFiles ? 'warning' : 'success' },
		{ id: 'duplicates', icon: 'content_copy', label: 'Duplicates', title: 'Duplicate uploads', value: `${formatNumber(s.duplicateGroups)} ${s.duplicateGroups === 1 ? 'group' : 'groups'}`, detail: `${formatBytes(s.duplicateWastedBytes)} could be freed`, tone: s.duplicateGroups ? 'warning' : 'success' },
		{ id: 'broken', icon: 'link_off', label: 'Broken links', title: 'Broken links', value: formatNumber(s.brokenReferences), detail: s.brokenReferences ? 'point to deleted files' : 'all links work', tone: s.brokenReferences ? 'danger' : 'success' },
		{ id: 'large', icon: 'photo_size_select_large', label: 'Large images', title: 'Large images', value: formatNumber(s.largeImages), detail: s.largeImages ? formatBytes(s.largeImagesBytes) : 'none over 4000 px or 10 MB', tone: s.largeImages ? 'warning' : 'success' },
	];
});

const activeCard = computed(() => cards.value.find((card) => card.id === active.value));

const selectedBytes = computed(() =>
	(report.value?.unusedFiles ?? []).filter((file) => selected.value.has(file.id)).reduce((total, file) => total + file.filesize, 0),
);
const allSelected = computed(() => selected.value.size > 0 && selected.value.size === report.value?.unusedFiles.length);

onMounted(() => {
	if (isAdmin.value) runScan();
});

async function runScan() {
	loading.value = true;
	error.value = null;

	try {
		const { data } = await api.get('/media-usage-analyzer/scan', { params: { content: scanContent.value } });
		report.value = data;
		const stillUnused = new Set(data.unusedFiles.map((file) => file.id));
		selected.value = new Set([...selected.value].filter((id) => stillUnused.has(id)));
	} catch (err) {
		error.value = errorMessage(err);
	} finally {
		loading.value = false;
	}
}

function toggle(id, checked) {
	const next = new Set(selected.value);
	if (checked) next.add(id);
	else next.delete(id);
	selected.value = next;
}

function selectAll(checked) {
	selected.value = checked ? new Set(report.value.unusedFiles.map((file) => file.id)) : new Set();
}

// The server re-checks every file in a dry run first, then deletes only the files it cleared
// (and re-verifies each batch again right before deleting it).
async function confirmDelete() {
	deleting.value = true;
	deleteResult.value = null;
	const ids = [...selected.value];

	try {
		const { data: preview } = await api.post(DELETE_URL, { ids, dryRun: true });
		const cleared = preview.results.filter((result) => result.status === 'would_delete').map((result) => result.id);
		const deletion = cleared.length ? (await api.post(DELETE_URL, { ids: cleared, dryRun: false })).data : null;
		const deleted = deletion?.summary.deleted ?? 0;
		deleteResult.value = { text: deletionResultText(preview, deletion), tone: deleted === ids.length ? 'success' : 'warning' };
		selected.value = new Set();
	} catch (err) {
		deleteResult.value = { text: `Nothing was deleted: ${errorMessage(err)}`, tone: 'danger' };
	} finally {
		deleting.value = false;
		deleteOpen.value = false;
	}

	await runScan();
}

function whereLabel(entry) {
	const collection = collectionsStore.getCollection(entry.usageCollection)?.name ?? entry.usageCollection;
	const field = fieldsStore.getField(entry.usageCollection, entry.usageField)?.name ?? entry.usageField;
	return `${collection} › ${field}${entry.kind === 'content' ? ' (link in text)' : ''}`;
}

function usedLabel(file) {
	return unusedIds.value.has(file.id) ? 'Unused' : 'In use';
}

function imageDetail(file) {
	const size = file.width && file.height ? `${file.width} × ${file.height} px` : 'Size unknown';
	return `${size} · ${usedLabel(file)}`;
}

function share(bytes) {
	const total = summary.value.totalBytes || 1;
	return `${Math.max(1, Math.round((bytes / total) * 100))}%`;
}

function errorMessage(err) {
	return err?.response?.data?.errors?.[0]?.message ?? err.message;
}

function exportReport(format) {
	const content = format === 'json' ? formatReportJson(report.value) : formatReportCsv(report.value);
	const blob = new Blob([content], { type: `${format === 'json' ? 'application/json' : 'text/csv'};charset=utf-8` });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = `media-usage-${new Date().toISOString().replaceAll(':', '-')}.${format}`;
	anchor.click();
	URL.revokeObjectURL(url);
}
</script>

<style scoped>
.media-usage-analyzer {
	padding: var(--content-padding);
	padding-bottom: var(--content-padding-bottom);
	max-width: 1200px;
}

.content-toggle {
	margin-right: 8px;
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

.cards {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
	gap: 12px;
	margin-bottom: 12px;
}

.card {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	gap: 4px;
	padding: 16px;
	text-align: left;
	color: var(--theme--foreground);
	background: var(--theme--background-subdued);
	border: var(--theme--border-width) solid var(--theme--border-color-subdued);
	border-radius: var(--theme--border-radius);
	cursor: pointer;
}

.card:hover {
	border-color: var(--theme--border-color);
}

.card.active {
	border-color: var(--theme--primary);
	box-shadow: inset 0 0 0 1px var(--theme--primary);
}

.card.focus {
	border-left: 4px solid var(--theme--primary);
}

.card-label {
	display: flex;
	align-items: center;
	gap: 6px;
	flex-wrap: wrap;
	color: var(--theme--foreground-subdued);
	font-size: 13px;
}

.card-badge {
	padding: 0 6px;
	border-radius: 999px;
	font-size: 11px;
	color: var(--theme--primary);
	background: var(--theme--primary-background, var(--theme--background-normal));
}

.card-value {
	font-size: 24px;
	font-weight: 700;
}

.card.success .card-value { color: var(--theme--success); }
.card.warning .card-value { color: var(--theme--warning); }
.card.danger .card-value { color: var(--theme--danger); }

.meta {
	margin: 0 0 16px;
}

.warning-text { color: var(--theme--warning); }
.danger-text { color: var(--theme--danger); }

.technical {
	margin: -8px 0 16px;
}

.technical ul {
	margin: 8px 0 0;
	padding-left: 20px;
}

.panel {
	background: var(--theme--background-subdued);
	border: var(--theme--border-width) solid var(--theme--border-color-subdued);
	border-radius: var(--theme--border-radius);
	padding: 20px;
	margin-bottom: 20px;
}

.type-title {
	margin-bottom: 4px;
}

.hint {
	margin: 0 0 16px;
}

.toolbar {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 12px;
	padding-bottom: 8px;
	border-bottom: var(--theme--border-width) solid var(--theme--border-color-subdued);
}

.toolbar .v-button {
	margin-left: auto;
}

.group {
	margin-bottom: 20px;
}

.group-title {
	display: flex;
	flex-wrap: wrap;
	align-items: baseline;
	gap: 8px;
	font-weight: 600;
}

.rows {
	margin: 0;
	padding: 0;
	list-style: none;
}

.row {
	display: grid;
	grid-template-columns: 24px minmax(0, 1fr) auto;
	align-items: center;
	gap: 12px;
	padding: 8px 0;
	border-bottom: var(--theme--border-width) solid var(--theme--border-color-subdued);
}

.row:last-child {
	border-bottom: none;
}

.name {
	display: flex;
	flex-direction: column;
	min-width: 0;
}

.open {
	color: var(--theme--primary);
}

.empty {
	padding: 24px 0;
	text-align: center;
	color: var(--theme--foreground-subdued);
}

.more {
	margin-top: 12px;
}

.bars {
	margin: 12px 0 0;
	padding: 0;
	list-style: none;
}

.bar-row {
	display: grid;
	grid-template-columns: 110px minmax(0, 1fr) 200px;
	align-items: center;
	gap: 12px;
	padding: 6px 0;
}

.bar-track {
	height: 8px;
	border-radius: 4px;
	background: var(--theme--background-normal);
	overflow: hidden;
}

.bar {
	display: block;
	height: 100%;
	border-radius: 4px;
	background: var(--theme--primary);
}

.muted { color: var(--theme--foreground-subdued); }
.small { font-size: 13px; }
.header-icon { margin-right: 8px; }
</style>
