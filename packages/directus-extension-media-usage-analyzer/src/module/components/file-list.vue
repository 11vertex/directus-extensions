<template>
	<ul class="file-list">
		<li v-for="file in files" :key="file.id" class="file-row" :class="{ selectable }">
			<v-checkbox
				v-if="selectable"
				:model-value="selected.has(file.id)"
				@update:model-value="emit('toggle', file.id, $event)"
			/>
			<span class="thumb">
				<img
					v-if="thumbUrl(file) && !failed.has(file.id)"
					:src="thumbUrl(file)"
					alt=""
					loading="lazy"
					@error="markFailed(file.id)"
				/>
				<v-icon v-else :name="iconFor(file.type)" />
			</span>
			<span class="name">
				<span class="title">{{ file.title || file.filename_download || 'Untitled file' }}</span>
				<span class="muted small">{{ detail ? detail(file) : typeLabel(file.type) }}</span>
			</span>
			<span class="size">{{ formatBytes(file.filesize) }}</span>
			<span class="muted small date" :title="fullDate(file.uploaded_on)">{{ timeAgo(file.uploaded_on) }}</span>
			<router-link class="open" :to="`/files/${file.id}`">Open</router-link>
		</li>
	</ul>
</template>

<script setup>
import { ref } from 'vue';
import { formatBytes, timeAgo, typeLabel } from '../../shared/format.js';

defineProps({
	files: { type: Array, required: true },
	selectable: { type: Boolean, default: false },
	selected: { type: Set, default: () => new Set() },
	detail: { type: Function, default: null },
});

const emit = defineEmits(['toggle']);

// Same root the app uses for asset URLs: everything before `/admin`. Auth is the app's session cookie.
const parts = window.location.href.split('/');
const adminIndex = parts.indexOf('admin');
const rootUrl = adminIndex === -1 ? `${window.location.origin}/` : `${parts.slice(0, adminIndex).join('/')}/`;

const failed = ref(new Set());

function thumbUrl(file) {
	if (!file.type?.startsWith('image/')) return null;
	const url = new URL(`assets/${file.id}`, rootUrl);
	if (file.type !== 'image/svg+xml') url.searchParams.set('key', 'system-small-cover');
	return url.href;
}

function markFailed(id) {
	failed.value = new Set([...failed.value, id]);
}

function iconFor(type = '') {
	if (type?.startsWith('image/')) return 'image';
	if (type?.startsWith('video/')) return 'movie';
	if (type?.startsWith('audio/')) return 'audio_file';
	if (type === 'application/pdf') return 'picture_as_pdf';
	return 'description';
}

function fullDate(value) {
	return value ? new Date(value).toLocaleString() : '';
}
</script>

<style scoped>
.file-list {
	margin: 0;
	padding: 0;
	list-style: none;
}

.file-row {
	display: grid;
	grid-template-columns: 40px minmax(0, 1fr) auto 110px auto;
	align-items: center;
	gap: 12px;
	padding: 8px 0;
	border-bottom: var(--theme--border-width) solid var(--theme--border-color-subdued);
}

.file-row.selectable {
	grid-template-columns: 24px 40px minmax(0, 1fr) auto 110px auto;
}

.file-row:last-child {
	border-bottom: none;
}

.thumb {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 40px;
	height: 40px;
	overflow: hidden;
	border-radius: var(--theme--border-radius);
	background: var(--theme--background-normal);
	color: var(--theme--foreground-subdued);
}

.thumb img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.name {
	display: flex;
	flex-direction: column;
	min-width: 0;
}

.title {
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.size {
	white-space: nowrap;
	text-align: right;
}

.open {
	color: var(--theme--primary);
}

.muted { color: var(--theme--foreground-subdued); }
.small { font-size: 13px; }
</style>
