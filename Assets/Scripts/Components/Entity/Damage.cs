using System;
using UnityEngine;
using UnityEngine.Events;

namespace Components.Entity
{
    public class Damage
    {
        public int Value { get; private set; }
        
        private int _initValue;

        public Damage(int damage)
        {
            _initValue = damage;
            Value = damage;
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
            Value += value;
        }
        
        public void Decrease(int value)
        {
            Value -= value;
        }
    }
}