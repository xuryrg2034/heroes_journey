using System;
using System.Collections.Generic;
using System.Linq;
using Cysharp.Threading.Tasks;
using Grid;
using UnityEngine;
using UnityEngine.Serialization;
using Object = UnityEngine.Object;

namespace Entities.Enemies
{
    [Serializable]
    public class MassAttackAbility : BaseAbility
    {
        public float attackDistance = 1.0f;
        [SerializeField] public LayerMask targetLayer;
        
        private static List<Vector2> _directions = new()
        {
            new Vector2(1, 0), // 0° - вправо
            new Vector2(1, 1), // 45° - вверх-вправо
            new Vector2(0, 1), // 90° - вверх
            new Vector2(-1, 1), // 135° - вверх-влево
            new Vector2(-1, 0), // 180° - влево
            new Vector2(-1, -1), // 225° - вниз-влево
            new Vector2(0, -1), // 270° - вниз
            new Vector2(1, -1), // 315° - вниз-вправо
        };

        private List<HitBox> _targets = new();

        public override async UniTask Execute()
        {
            if (_tryToExecute())
            {
                await _execute();
                _reset(State.Completed);
            }
            else if (State != State.Preparing)
            {
                _prepare();   
            }
        }
        
        public override void Cancel()
        {
            if (State != State.Preparing) return;

            _reset();
        }

        private void _prepare()
        {
            State = State.Preparing;
            
            foreach (var direction in _directions)
            {
                Debug.DrawRay(Owner.transform.position, direction * attackDistance, Color.red, 5f, true);
            }
        }

        private async UniTask _execute()
        {
            State = State.Execute;
            
            var tasks = new List<UniTask>();

            foreach (var direction in _directions)
            {
                var hit = Physics2D.Raycast(Owner.transform.position, direction, attackDistance, targetLayer);
                
                if (hit.collider != null)
                {
                    var entity = hit.collider.GetComponent<BaseEntity>();

                    if (entity)
                    {
                        tasks.Add(entity.Health.TakeDamage(1));
                    }
                }
            }

            await UniTask.WhenAll(tasks);
        }

        private void _reset(State state = State.Pending)
        {
            foreach (var target in _targets)
            {
                Object.Destroy(target.gameObject);
            }
            _targets.Clear();
            _castCounter = 0;
            State = state;
        }
    }
}