using System;
using UnityEngine;
using UnityEngine.Events;

namespace Components.Entity
{
    public class Energy
    {
        private int _value;

        private int _reserved;
        
        public UnityEvent<int> OnValueChanged = new();
        
        public UnityEvent<int> OnReservedChanged = new();

        public int Value
        {
            get => _value;
            private set
            {
                _value = value;
                OnValueChanged.Invoke(_value);
            }
        }
        
        public int Reserved
        {
            get => _reserved;
            private set
            {
                _reserved = value;
                OnReservedChanged.Invoke(_reserved);
            }
        }

        private int _initValue;

        public Energy(int energy)
        {
            _initValue = energy;
            Value = energy;
        }

        public void Reset()
        {
            Value = _initValue;
        }

        public void SetValue(int value)
        {
            Value = value;
        }

        public void Increase(int value)
        {
            Value -= value;
        }
        
        public void Decrease(int value)
        {
            Value -= value;
        }

        public void SetReserve(int value)
        {
            Reserved = value;
        }
    }
}