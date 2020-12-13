import React from 'react';
import { Box } from '@rocket.chat/fuselage';

import VerticalBar from './VerticalBar';
import AutoTranslate from './AutoTranslate';

export default {
	title: 'components/basic/AutoTranslate',
	component: AutoTranslate,
};

const languages = [
	['en', 'English'],
	['jp', 'Japanese'],
	['pt', 'Portuguese'],
];

export const Default = () => (
	<Box height='600px'>
		<VerticalBar>
			<AutoTranslate languages={languages} defaultLanguage='en'/>
		</VerticalBar>
	</Box>
);
