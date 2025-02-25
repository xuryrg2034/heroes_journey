using System;
using UnityEngine;
using UnityEngine.Events;

namespace Components.Entity
{
    public class Energy
    {
        public int Value { get; private set; }

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

        public void SetValue(int target)
        {
            Value = target;
        }

        public void Increase(int data)
        {
            Value -= data;
        }
        
        public void Decrease(int data)
        {
            Value -= data;
        }
    }
}