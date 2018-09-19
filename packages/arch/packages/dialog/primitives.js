// @flow

import React, { type ComponentType, type Ref } from 'react';
import styled from 'react-emotion';

import { colors } from '../theme';
import { alpha } from '../color-utils';

const outerGutter = 40;
const innerGutter = 20;

export const Positioner = styled.div(({ width }) => ({
  display: 'flex',
  flexDirection: 'column',
  left: 0,
  marginLeft: 'auto',
  marginRight: 'auto',
  maxHeight: `calc(100% - ${outerGutter * 2}px)`,
  maxWidth: width,
  position: 'fixed',
  right: 0,
  top: outerGutter,
  zIndex: 2,
}));

type DialogElementProps = {
  component: ComponentType<*> | string,
  innerRef?: Ref<*>,
};
export const Dialog = ({
  component: Tag,
  innerRef,
  ...props
}: DialogElementProps) => (
  <Tag
    ref={innerRef}
    role="dialog"
    css={{
      backgroundColor: 'white',
      borderRadius: 5,
      boxShadow: '0 2px 8px -1px rgba(0,0,0,0.3)',
      display: 'flex',
      flex: 1,
      flexDirection: 'column',
      maxHeight: '100%',
    }}
    {...props}
  />
);

export const HeadFoot = styled.div({
  lineHeight: 1,
  margin: `0 ${innerGutter}px`,
  paddingBottom: innerGutter,
  paddingTop: innerGutter,

  // ensure that box-shadow covers body content
  position: 'relative',
  zIndex: 1,
});
export const Header = styled(HeadFoot)({
  boxShadow: `0 2px 0 ${alpha(colors.text, 0.12)}`,
});
export const Footer = styled(HeadFoot)({
  boxShadow: `0 -2px 0 ${alpha(colors.text, 0.12)}`,
});
export const Title = styled.h3({
  fontSize: 18,
  fontWeight: 500,
  margin: 0,
});
export const Body = styled.div({
  lineHeight: 1.4,
  overflowY: 'auto',
  padding: innerGutter,
});
