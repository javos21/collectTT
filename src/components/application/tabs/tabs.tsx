'use client';

import { Fragment, type ReactNode } from 'react';
import type { Key, TabListProps, TabProps, TabsProps as AriaTabsProps } from 'react-aria-components';
import { Tab, TabList, Tabs as AriaTabs } from 'react-aria-components';

import { cx } from '@/lib/cx';

export interface TabItem {
  id: string;
  label: string;
  badge?: number;
}

interface TabsRootProps extends AriaTabsProps {
  className?: string;
}

interface TabsListProps extends Omit<TabListProps<TabItem>, 'items' | 'children' | 'className'> {
  items: readonly TabItem[];
  children: (item: TabItem) => ReactNode;
  className?: string;
  type?: string;
}

interface TabsItemProps extends Omit<TabProps, 'children' | 'id'>, Omit<TabItem, 'id'> {
  id: Key;
}

function TabsRoot({ className, ...props }: TabsRootProps) {
  return <AriaTabs {...props} className={cx('app-tabs', className)} />;
}

function TabsList({ items, children, className, type, ...props }: TabsListProps) {
  return (
    <TabList {...props} className={cx('app-tabs__list', type && `app-tabs__list--${type}`, className)}>
      {items.map((item) => <Fragment key={item.id}>{children(item)}</Fragment>)}
    </TabList>
  );
}

function TabsItem({ id, label, badge, className, ...props }: TabsItemProps) {
  return (
    <Tab
      {...props}
      id={id}
      className={(renderProps) =>
        cx(
          'app-tabs__item',
          typeof className === 'function' ? className(renderProps) : className,
          renderProps.isSelected && 'is-selected',
        )
      }
    >
      {({ isSelected }) => (
        <>
          <span>{label}</span>
          {badge !== undefined && <span className="app-tabs__badge">{badge}</span>}
          <span className="app-tabs__indicator" aria-hidden="true" data-selected={isSelected} />
        </>
      )}
    </Tab>
  );
}

export const Tabs = Object.assign(TabsRoot, { List: TabsList, Item: TabsItem });
