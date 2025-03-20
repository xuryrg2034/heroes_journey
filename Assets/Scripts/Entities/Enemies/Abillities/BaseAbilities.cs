using System;
using Cysharp.Threading.Tasks;
using UnityEngine;

namespace Entities.Enemies
{
    [Serializable]
    public abstract class BaseAbility
    {
        [SerializeField] private bool enable;
        [SerializeField] private int order = 100;
        [SerializeField][Min(1)] protected int castTime = 1;
        [HideInInspector] public Enemy Owner;

        protected  int _castCounter;
        
        public State State { get; protected set; } = State.Pending;

        public int Order => order;
        
        public bool Enable
        {   
            get => enable;
            set
            {
                enable = value;
            }
        }
        
        protected BaseAbility() {}

        protected bool _tryToExecute()
        {
            _castCounter += 1;
            var isReady = _castCounter > castTime;

            return isReady;
        }
        
        public abstract UniTask Execute();

        public abstract void Cancel();
        
        public virtual void Init(Enemy owner)
        {
            Owner = owner;
        }
        
        protected bool _isInRange(Vector2Int origin, Vector2Int target, int range)
        {
            var dx = Mathf.Abs(origin.x - target.x);
            var dy = Mathf.Abs(origin.y - target.y);

            // Используем челночное расстояние
            return Mathf.Max(dx, dy) <= range;
        }
        
        protected void _drawDebugPoint(Vector3 point, Color color, float duration = 1)
        {
            var size = 0.3f;

            Debug.DrawLine(point + Vector3.left * size, point + Vector3.right * size, color, duration);
            Debug.DrawLine(point + Vector3.up * size, point + Vector3.down * size, color, duration);
        }
    }

    public enum State
    {
        Pending,
        Preparing,
        Execute,
        Completed,
    }
}