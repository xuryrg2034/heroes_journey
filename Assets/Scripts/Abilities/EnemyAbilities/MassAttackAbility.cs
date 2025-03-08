using System;
using System.Collections.Generic;
using System.Linq;
using Cysharp.Threading.Tasks;
using Grid;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Abilities.EnemyAbilities
{
    [Serializable]
    public class MassAttackAbility : BaseAbility
    {
        [SerializeField] private TargetZone targetZonePrefab;
        
        // private static List<Vector3Int> _directions = new()
        // {
        //     new Vector3Int(1, 0, 0), // 0° - вправо
        //     // new Vector3Int(1, 1, 0), // 45° - вверх-вправо
        //     new Vector3Int(0, 1, 0), // 90° - вверх
        //     // new Vector3Int(-1, 1, 0), // 135° - вверх-влево
        //     new Vector3Int(-1, 0, 0), // 180° - влево
        //     // new Vector3Int(-1, -1, 0), // 225° - вниз-влево
        //     new Vector3Int(0, -1, 0), // 270° - вниз
        //     // new Vector3Int(1, -1, 0), // 315° - вниз-вправо
        // };

        private List<TargetZone> _targets = new();

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

            var aroundCells = Owner.Cell
                .GetNeighbors()
                .Where((item) => item.Type != CellType.Blocked)
                .ToList();

            // foreach (var direction in _directions)
            // {
            //     _targets.Add(_createTargetZone(Owner.transform.position + direction));
            // }
            
            foreach (var cell in aroundCells)
            {
                _targets.Add(_createTargetZone(cell.transform.position));
            }
        }
        
        private TargetZone _createTargetZone(Vector3 position)
        {
            var targetObj = Object.Instantiate(targetZonePrefab, position, Quaternion.identity, Owner.transform);
            var sr = targetObj.GetComponent<SpriteRenderer>();
            
            sr.sortingOrder = 90;

            return targetObj;
        }

        private async UniTask _execute()
        {
            State = State.Execute;

            var tasks = new List<UniTask>();
            
            foreach (var target in _targets)
            {
                var zone = target.GetComponent<TargetZone>();
                var entity = zone.Target;

                if (entity)
                {
                    tasks.Add(entity.Health.TakeDamage(1));
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