import s from 'underscore.string';
import React, { useCallback, useMemo, useState, useEffect, useRef, memo } from 'react';
import { Box, Icon, TextInput, Select, Margins, Callout } from '@rocket.chat/fuselage';
import { FixedSizeList as List } from 'react-window';
import InfiniteLoader from 'react-window-infinite-loader';
import { useDebouncedValue, useResizeObserver, useLocalStorage } from '@rocket.chat/fuselage-hooks';

import VerticalBar from '../../../components/basic/VerticalBar';
import { useTranslation } from '../../../contexts/TranslationContext';
import { useRoute, useCurrentRoute } from '../../../contexts/RouterContext';
import { call, renderMessageBody } from '../../../../app/ui-utils/client';
import { useUserId, useUserSubscription } from '../../../contexts/UserContext';
import { ENDPOINT_STATES } from '../../../hooks/useEndpointDataExperimental';
import { useUserRoom } from '../../hooks/useUserRoom';
import { useSetting } from '../../../contexts/SettingsContext';
import { useTimeAgo } from '../../../hooks/useTimeAgo';
import { clickableItem } from '../../helpers/clickableItem';
import { MessageSkeleton } from '../../components/Message';
import ThreadListMessage from './components/Message';
import { getConfig } from '../../../../app/ui-utils/client/config';
import { useEndpoint } from '../../../contexts/ServerContext';

function mapProps(WrappedComponent) {
	return ({ msg, username, replies, tcount, ts, ...props }) => <WrappedComponent replies={tcount} participants={replies.length} username={username} msg={msg} ts={ts} {...props}/>;
}

const Thread = React.memo(mapProps(clickableItem(ThreadListMessage)));

const Skeleton = React.memo(clickableItem(MessageSkeleton));

const LIST_SIZE = parseInt(getConfig('threadsListSize')) || 25;

const filterProps = ({ msg, u, replies, mentions, tcount, ts, _id, tlm, attachments }) => ({ ..._id && { _id }, attachments, mentions, msg, u, replies, tcount, ts: new Date(ts), tlm: new Date(tlm) });

const subscriptionFields = { tunread: 1, tunreadUser: 1, tunreadGroup: 1 };
const roomFields = { t: 1, name: 1 };

export function withData(WrappedComponent) {
	return ({ rid, ...props }) => {
		const room = useUserRoom(rid, roomFields);
		const subscription = useUserSubscription(rid, subscriptionFields);
		const userId = useUserId();

		const [{
			state,
			error,
			threads,
			count,
		}, setState] = useState(() => ({
			state: ENDPOINT_STATES.LOADING,
			error: null,
			threads: [],
			count: 0,
		}));
		const [type, setType] = useLocalStorage('thread-list-type', 'all');
		const [text, setText] = useState('');

		const mergeThreads = useCallback(
			(threads, newThreads) =>
				Array.from(
					new Map([
						...threads.map((msg) => [msg._id, msg]),
						...newThreads.map((msg) => [msg._id, msg]),
					]).values(),
				)
					.sort((a, b) => b.tlm.getTime() - a.tlm.getTime()),
			[],
		);

		const getThreadsList = useEndpoint('GET', 'chat.getThreadsList');
		const fetchThreads = useCallback(async ({ rid, offset, limit, type, text }) => {
			try {
				const data = await getThreadsList({
					rid,
					offset,
					count: limit,
					type,
					text,
				});

				setState(({ threads }) => ({
					state: ENDPOINT_STATES.DONE,
					error: null,
					threads: mergeThreads(offset === 0 ? [] : threads, data.threads.map(filterProps)),
					count: data.total,
				}));
			} catch (error) {
				setState(({ threads, count }) => ({
					state: ENDPOINT_STATES.ERROR,
					error,
					threads,
					count,
				}));
			}
		}, [getThreadsList, mergeThreads]);

		const debouncedText = useDebouncedValue(text, 400);
		useEffect(() => {
			fetchThreads({
				rid: room._id,
				offset: 0,
				limit: LIST_SIZE,
				type,
				text: debouncedText,
			});
		}, [debouncedText, fetchThreads, room._id, type]);

		const loadMoreItems = useCallback((start, end) => fetchThreads({
			rid: room._id,
			offset: start,
			limit: end - start,
			type,
			text,
		}), [fetchThreads, room._id, type, text]);

		const handleTextChange = useCallback((event) => {
			setText(event.currentTarget.value);
		}, []);

		return <WrappedComponent
			{...props}
			unread={subscription?.tunread}
			unreadUser={subscription?.tunreadUser}
			unreadGroup={subscription?.tunreadGroup}
			userId={userId}
			error={error}
			threads={threads}
			total={count}
			loading={state === ENDPOINT_STATES.LOADING}
			loadMoreItems={loadMoreItems}
			room={room}
			text={text}
			setText={handleTextChange}
			type={type}
			setType={setType}
		/>;
	};
}

const handleFollowButton = (e) => {
	e.preventDefault();
	e.stopPropagation();
	call(![true, 'true'].includes(e.currentTarget.dataset.following) ? 'followMessage' : 'unfollowMessage', { mid: e.currentTarget.dataset.id });
};

export const normalizeThreadMessage = ({ ...message }) => {
	if (message.msg) {
		return renderMessageBody(message).replace(/<br\s?\\?>/g, ' ');
	}

	if (message.attachments) {
		const attachment = message.attachments.find((attachment) => attachment.title || attachment.description);

		if (attachment && attachment.description) {
			return s.escapeHTML(attachment.description);
		}

		if (attachment && attachment.title) {
			return s.escapeHTML(attachment.title);
		}
	}
};

const Row = memo(function Row({
	data,
	index,
	style,
	showRealNames,
	unread,
	unreadUser,
	unreadGroup,
	userId,
	onClick,
}) {
	const t = useTranslation();
	const formatDate = useTimeAgo();

	if (!data[index]) {
		return <Skeleton style={style}/>;
	}
	const thread = data[index];
	const msg = normalizeThreadMessage(thread);

	const { name = thread.u.username } = thread.u;

	return <Thread
		{ ...thread }
		name={showRealNames ? name : thread.u.username }
		username={ thread.u.username }
		style={style}
		unread={unread.includes(thread._id)}
		mention={unreadUser.includes(thread._id)}
		all={unreadGroup.includes(thread._id)}
		following={thread.replies && thread.replies.includes(userId)}
		data-id={thread._id}
		msg={msg}
		t={t}
		formatDate={formatDate}
		handleFollowButton={handleFollowButton} onClick={onClick}
	/>;
});

export function ThreadList({ total = 10, threads = [], room, unread = [], unreadUser = [], unreadGroup = [], type, setType, loadMoreItems, loading, onClose, error, userId, text, setText }) {
	const showRealNames = useSetting('UI_Use_Real_Name');
	const threadsRef = useRef();

	const t = useTranslation();

	const [name] = useCurrentRoute();
	const channelRoute = useRoute(name);
	const onClick = useCallback((e) => {
		const { id: context } = e.currentTarget.dataset;
		channelRoute.push({
			tab: 'thread',
			context,
			rid: room._id,
			name: room.name,
		});
	}, [channelRoute, room._id, room.name]);

	const options = useMemo(() => [['all', t('All')], ['following', t('Following')], ['unread', t('Unread')]], [t]);

	threadsRef.current = threads;

	const rowRenderer = useCallback(({ data, index, style }) => <Row
		data={data}
		index={index}
		style={style}
		showRealNames={showRealNames}
		unread={unread}
		unreadUser={unreadUser}
		unreadGroup={unreadGroup}
		userId={userId}
		onClick={onClick}
	/>, [showRealNames, unread, unreadUser, unreadGroup, userId, onClick]);

	const isItemLoaded = useCallback((index) => index < threadsRef.current.length, []);
	const { ref, contentBoxSize: { inlineSize = 378, blockSize = 1 } = {} } = useResizeObserver({ debounceDelay: 100 });

	return <VerticalBar>
		<VerticalBar.Header>
			<Icon name='thread' size='x20'/>
			<Box flexShrink={1} flexGrow={1} withTruncatedText mi='x8'>{t('Threads')}</Box>
			<VerticalBar.Close onClick={onClose}/>
		</VerticalBar.Header>
		<VerticalBar.Content paddingInline={0}>
			<Box display='flex' flexDirection='row' p='x24' borderBlockEndWidth='x2' borderBlockEndStyle='solid' borderBlockEndColor='neutral-200' flexShrink={0}>
				<Box display='flex' flexDirection='row' flexGrow={1} mi='neg-x8'>
					<Margins inline='x8'>
						<TextInput placeholder={t('Search_Messages')} value={text} onChange={setText} addon={<Icon name='magnifier' size='x20'/>}/>
						<Select flexGrow={0} width='110px' onChange={setType} value={type} options={options} />
					</Margins>
				</Box>
			</Box>
			<Box flexGrow={1} flexShrink={1} ref={ref} overflow='hidden'>
				{error && <Callout mi='x24' type='danger'>{error.toString()}</Callout>}
				{total === 0 && <Box p='x24'>{t('No_Threads')}</Box>}
				{!error && total > 0 && <InfiniteLoader
					isItemLoaded={isItemLoaded}
					itemCount={total}
					loadMoreItems={ loading ? () => {} : loadMoreItems}
				>
					{({ onItemsRendered, ref }) => (<List
						height={blockSize}
						width={inlineSize}
						itemCount={total}
						itemData={threads}
						itemSize={124}
						ref={ref}
						minimumBatchSize={LIST_SIZE}
						onItemsRendered={onItemsRendered}
					>{rowRenderer}</List>
					)}
				</InfiniteLoader>}
			</Box>
		</VerticalBar.Content>
	</VerticalBar>;
}

export default withData(ThreadList);
