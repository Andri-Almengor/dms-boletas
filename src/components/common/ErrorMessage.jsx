import React from 'react';
import Icon from './Icon';

export default function ErrorMessage({ message }) {
  if (!message) return null;
  return (
    <div className="alert alert--error" role="alert">
      <Icon name="error" filled />
      <span>{message}</span>
    </div>
  );
}
